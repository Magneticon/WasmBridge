#include "buffers.h"
#include <stddef.h>
#include <stdint.h>
#include <limits.h>
#ifndef __wasm__
#include <stdlib.h>
#else
/* Provided by wasm-ld. This address follows the module's statics and stack. */
extern unsigned char __heap_base;
#endif

#define WB_ALIGN ((wb_size_t)8)
#define WB_PAGE_BYTES UINT64_C(65536)
#define WB_MAGIC UINT32_C(0x5742424c) /* 'WBBL' */

static int wb_align_size(wb_size_t value, wb_size_t *result)
{
    wb_size_t maximum = (wb_size_t)~(wb_size_t)0;
    wb_size_t mask = WB_ALIGN - 1;
    if (!result || value == 0 || value > maximum - mask) return 0;
    *result = (value + mask) & ~mask;
    return *result != 0;
}

uint32_t wb_address_bits(void)
{
#ifdef __wasm64__
    return 64U;
#elif defined(__wasm__)
    return 32U;
#else
    return (uint32_t)(sizeof(void *) * CHAR_BIT);
#endif
}

#ifndef __wasm__

typedef struct wb_native_block {
    struct wb_native_block *next;
    wb_size_t capacity;
} wb_native_block;

static wb_native_block *wb_native_blocks;
static uint32_t wb_native_active;

static wb_native_block *wb_native_lookup(unsigned char *pointer, wb_native_block **previous)
{
    wb_native_block *prev = NULL;
    wb_native_block *block = wb_native_blocks;
    while (block) {
        if ((unsigned char *)(block + 1) == pointer) {
            if (previous) *previous = prev;
            return block;
        }
        prev = block;
        block = block->next;
    }
    if (previous) *previous = NULL;
    return NULL;
}

unsigned char *wb_alloc(wb_size_t bytes)
{
    wb_size_t size;
    wb_native_block *block;
    if (!wb_align_size(bytes, &size)) return NULL;
    if ((uint64_t)size + (uint64_t)sizeof(wb_native_block) > (uint64_t)SIZE_MAX) return NULL;
    block = (wb_native_block *)malloc(sizeof(wb_native_block) + (size_t)size);
    if (!block) return NULL;
    block->capacity = size;
    block->next = wb_native_blocks;
    wb_native_blocks = block;
    ++wb_native_active;
    return (unsigned char *)(block + 1);
}

int wb_free(unsigned char *pointer)
{
    wb_native_block *previous = NULL;
    wb_native_block *block = wb_native_lookup(pointer, &previous);
    if (!block) return 0;
    if (previous) previous->next = block->next;
    else wb_native_blocks = block->next;
    free(block);
    if (wb_native_active) --wb_native_active;
    return 1;
}

wb_size_t wb_capacity(unsigned char *pointer)
{
    wb_native_block *block = wb_native_lookup(pointer, NULL);
    return block ? block->capacity : (wb_size_t)0;
}

uint32_t wb_active_count(void)
{
    return wb_native_active;
}

#else /* __wasm__ */

typedef struct wb_wasm_block {
    uintptr_t next;
    wb_size_t capacity;
    uint32_t magic;
    uint32_t active;
} wb_wasm_block;

#define WB_HEADER_BYTES ((uintptr_t)((sizeof(wb_wasm_block) + 7U) & ~(size_t)7U))

static uintptr_t wb_first;
static uintptr_t wb_last;
static uint64_t wb_heap_end;
static uint32_t wb_wasm_active;

static uint64_t wb_memory_bytes(void)
{
    uint64_t pages = (uint64_t)__builtin_wasm_memory_size(0);
    if (pages > UINT64_MAX / WB_PAGE_BYTES) return UINT64_MAX;
    return pages * WB_PAGE_BYTES;
}

static uint64_t wb_heap_base_address(void)
{
    uint64_t base = (uint64_t)(uintptr_t)&__heap_base;
    return (base + 7U) & ~UINT64_C(7);
}

static unsigned char *wb_payload(wb_wasm_block *block)
{
    return (unsigned char *)((uintptr_t)block + WB_HEADER_BYTES);
}

static wb_wasm_block *wb_block_at(uintptr_t address)
{
    return address ? (wb_wasm_block *)address : NULL;
}

static int wb_valid_block(wb_wasm_block *block)
{
    return block && block->magic == WB_MAGIC;
}

static wb_wasm_block *wb_lookup(unsigned char *pointer)
{
    uintptr_t current = wb_first;
    while (current) {
        wb_wasm_block *block = wb_block_at(current);
        if (!wb_valid_block(block)) return NULL;
        if (wb_payload(block) == pointer) return block;
        current = block->next;
    }
    return NULL;
}

static int wb_can_place(uint64_t start, uint64_t payload_size, uint64_t *end)
{
    uint64_t header = (uint64_t)WB_HEADER_BYTES;
    uint64_t available = wb_memory_bytes();
    if (!end || start > UINT64_MAX - header) return 0;
    start += header;
    if (payload_size > UINT64_MAX - start) return 0;
    *end = start + payload_size;
    if (*end > available) return 0;
    /* A block header itself must have a representable linear-memory address. */
    if ((*end != 0 && start - header > (uint64_t)(uintptr_t)~(uintptr_t)0)) return 0;
    return 1;
}

static void wb_split_free_block(wb_wasm_block *block, wb_size_t wanted)
{
    uint64_t remainder;
    uintptr_t new_address;
    wb_wasm_block *new_block;
    if (!block || block->capacity <= wanted) return;
    remainder = (uint64_t)block->capacity - (uint64_t)wanted;
    if (remainder < (uint64_t)WB_HEADER_BYTES + (uint64_t)WB_ALIGN) return;
    new_address = (uintptr_t)((uint64_t)(uintptr_t)wb_payload(block) + (uint64_t)wanted);
    new_block = wb_block_at(new_address);
    new_block->next = block->next;
    new_block->capacity = (wb_size_t)(remainder - (uint64_t)WB_HEADER_BYTES);
    new_block->magic = WB_MAGIC;
    new_block->active = 0;
    block->capacity = wanted;
    block->next = new_address;
    if (wb_last == (uintptr_t)block) wb_last = new_address;
}

static void wb_coalesce(void)
{
    uintptr_t current = wb_first;
    while (current) {
        wb_wasm_block *block = wb_block_at(current);
        uintptr_t next_address;
        wb_wasm_block *next;
        uint64_t merged;
        if (!wb_valid_block(block)) return;
        next_address = block->next;
        if (!next_address) break;
        next = wb_block_at(next_address);
        if (!wb_valid_block(next)) return;
        if (!block->active && !next->active &&
            (uint64_t)(uintptr_t)wb_payload(block) + (uint64_t)block->capacity == (uint64_t)next_address) {
            merged = (uint64_t)block->capacity + (uint64_t)WB_HEADER_BYTES + (uint64_t)next->capacity;
            if (merged <= (uint64_t)(wb_size_t)~(wb_size_t)0) {
                block->capacity = (wb_size_t)merged;
                block->next = next->next;
                if (wb_last == next_address) wb_last = current;
                continue;
            }
        }
        current = block->next;
    }
}

static void wb_trim_tail(void)
{
    while (wb_last) {
        uintptr_t current = wb_first;
        uintptr_t previous = 0;
        wb_wasm_block *last = wb_block_at(wb_last);
        if (!wb_valid_block(last) || last->active) return;
        while (current && current != wb_last) {
            wb_wasm_block *block = wb_block_at(current);
            if (!wb_valid_block(block)) return;
            previous = current;
            current = block->next;
        }
        if (current != wb_last) return;
        wb_heap_end = (uint64_t)wb_last;
        last->magic = 0;
        if (previous) {
            wb_wasm_block *prev = wb_block_at(previous);
            prev->next = 0;
            wb_last = previous;
        } else {
            wb_first = 0;
            wb_last = 0;
            wb_heap_end = wb_heap_base_address();
        }
    }
}

unsigned char *wb_alloc(wb_size_t bytes)
{
    wb_size_t size;
    uintptr_t current;
    uint64_t end;
    uintptr_t header_address;
    wb_wasm_block *block;
    if (!wb_align_size(bytes, &size)) return NULL;

    current = wb_first;
    while (current) {
        block = wb_block_at(current);
        if (!wb_valid_block(block)) return NULL;
        if (!block->active && block->capacity >= size) {
            wb_split_free_block(block, size);
            block->active = 1;
            ++wb_wasm_active;
            return wb_payload(block);
        }
        current = block->next;
    }

    if (!wb_heap_end) wb_heap_end = wb_heap_base_address();
    if (!wb_can_place(wb_heap_end, (uint64_t)size, &end))
        return NULL; /* JS host may grow exported memory and retry. */
    if (wb_heap_end > (uint64_t)(uintptr_t)~(uintptr_t)0) return NULL;

    header_address = (uintptr_t)wb_heap_end;
    block = wb_block_at(header_address);
    block->next = 0;
    block->capacity = size;
    block->magic = WB_MAGIC;
    block->active = 1;
    if (wb_last) {
        wb_wasm_block *last = wb_block_at(wb_last);
        if (!wb_valid_block(last)) return NULL;
        last->next = header_address;
    } else {
        wb_first = header_address;
    }
    wb_last = header_address;
    wb_heap_end = end;
    ++wb_wasm_active;
    return wb_payload(block);
}

int wb_free(unsigned char *pointer)
{
    wb_wasm_block *block = wb_lookup(pointer);
    if (!block || !block->active) return 0;
    block->active = 0;
    if (wb_wasm_active) --wb_wasm_active;
    wb_coalesce();
    wb_trim_tail();
    return 1;
}

wb_size_t wb_capacity(unsigned char *pointer)
{
    wb_wasm_block *block = wb_lookup(pointer);
    return block && block->active ? block->capacity : (wb_size_t)0;
}

uint32_t wb_active_count(void)
{
    return wb_wasm_active;
}

#endif /* __wasm__ */

wb_size_t wb_invert_rgba(unsigned char *source, unsigned char *destination, wb_size_t bytes)
{
#ifdef __wasm__
    wb_wasm_block *input = wb_lookup(source);
    wb_wasm_block *output = wb_lookup(destination);
#else
    wb_native_block *input = wb_native_lookup(source, NULL);
    wb_native_block *output = wb_native_lookup(destination, NULL);
#endif
    wb_size_t i;
    if (bytes == 0 || (bytes & (wb_size_t)3) != 0 || !input || !output ||
#ifdef __wasm__
        !input->active || !output->active ||
#endif
        bytes > input->capacity || bytes > output->capacity)
        return (wb_size_t)~(wb_size_t)0;
    /* Only exact aliasing (in-place) or nonoverlapping allocations are supported. */
    for (i = 0; i < bytes; i += (wb_size_t)4) {
        destination[i] = (unsigned char)(255U - source[i]);
        destination[i + 1] = (unsigned char)(255U - source[i + 1]);
        destination[i + 2] = (unsigned char)(255U - source[i + 2]);
        destination[i + 3] = source[i + 3];
    }
    return bytes;
}
