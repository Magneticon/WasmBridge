#include "buffers.h"
#include <stddef.h>
#include <stdint.h>
#ifndef __wasm__
#include <stdlib.h>
#else
/* Provided by wasm-ld. This address follows the module's statics and stack. */
extern unsigned char __heap_base;
#endif

#define WB_SLOTS 128
#define WB_LIMIT (32U * 1024U * 1024U)
#define WB_PAGE 65536U

typedef struct wb_block {
    unsigned char *address;
    unsigned int capacity;
    int active;
} wb_block;
static wb_block wb_blocks[WB_SLOTS];
#ifdef __wasm__
static unsigned int wb_next;

static void wb_clear_block(wb_block *block)
{
    block->address = NULL;
    block->capacity = 0;
    block->active = 0;
}

static void wb_coalesce_and_trim(void)
{
    int i, j, changed = 1;
    while (changed) {
        changed = 0;
        for (i = 0; i < WB_SLOTS && !changed; ++i) {
            unsigned int i_start;
            if (wb_blocks[i].active || !wb_blocks[i].address) continue;
            i_start = (unsigned int)(uintptr_t)wb_blocks[i].address;
            for (j = i + 1; j < WB_SLOTS; ++j) {
                unsigned int j_start;
                if (wb_blocks[j].active || !wb_blocks[j].address) continue;
                j_start = (unsigned int)(uintptr_t)wb_blocks[j].address;
                if (i_start + wb_blocks[i].capacity == j_start) {
                    wb_blocks[i].capacity += wb_blocks[j].capacity;
                    wb_clear_block(&wb_blocks[j]);
                    changed = 1;
                    break;
                }
                if (j_start + wb_blocks[j].capacity == i_start) {
                    wb_blocks[j].capacity += wb_blocks[i].capacity;
                    wb_clear_block(&wb_blocks[i]);
                    changed = 1;
                    break;
                }
            }
        }
    }
    changed = 1;
    while (changed) {
        changed = 0;
        for (i = 0; i < WB_SLOTS; ++i) {
            if (!wb_blocks[i].active && wb_blocks[i].address &&
                (unsigned int)(uintptr_t)wb_blocks[i].address + wb_blocks[i].capacity == wb_next) {
                wb_next = (unsigned int)(uintptr_t)wb_blocks[i].address;
                wb_clear_block(&wb_blocks[i]);
                changed = 1;
                break;
            }
        }
    }
}
#endif

static wb_block *wb_lookup(unsigned char *pointer, int only_active)
{
    int i;
    if (!pointer) return NULL;
    for (i = 0; i < WB_SLOTS; ++i) {
        if (wb_blocks[i].address == pointer &&
            (!only_active || wb_blocks[i].active))
            return &wb_blocks[i];
    }
    return NULL;
}

unsigned char *wb_alloc(int bytes)
{
    int i, free_slot = -1;
    unsigned int size;
    unsigned char *address;
    if (bytes <= 0 || (unsigned int)bytes > WB_LIMIT) return NULL;
    size = ((unsigned int)bytes + 7U) & ~7U;
    for (i = 0; i < WB_SLOTS; ++i) {
        if (!wb_blocks[i].active && wb_blocks[i].address &&
            wb_blocks[i].capacity >= size) {
            wb_blocks[i].active = 1;
            return wb_blocks[i].address;
        }
        if (!wb_blocks[i].active && !wb_blocks[i].address && free_slot < 0)
            free_slot = i;
    }
    if (free_slot < 0) return NULL;
#ifdef __wasm__
    {
        unsigned int end, bytes_available;
        if (!wb_next) wb_next = ((unsigned int)(uintptr_t)&__heap_base + 7U) & ~7U;
        bytes_available = __builtin_wasm_memory_size(0) * WB_PAGE;
        if (size > WB_LIMIT || wb_next > WB_LIMIT ||
            size > WB_LIMIT - wb_next ||
            wb_next > bytes_available || size > bytes_available - wb_next)
            return NULL; /* JS host may grow exported memory and retry. */
        end = wb_next + size;
        address = (unsigned char *)(uintptr_t)wb_next;
        wb_next = end;
    }
#else
    address = (unsigned char *)malloc(size);
    if (!address) return NULL;
#endif
    wb_blocks[free_slot].address = address;
    wb_blocks[free_slot].capacity = size;
    wb_blocks[free_slot].active = 1;
    return address;
}

int wb_free(unsigned char *pointer)
{
    wb_block *block = wb_lookup(pointer, 1);
    if (!block) return 0;
    block->active = 0;
#ifndef __wasm__
    free(block->address);
    block->address = NULL;
    block->capacity = 0;
#else
    wb_coalesce_and_trim();
#endif
    return 1;
}

int wb_capacity(unsigned char *pointer)
{
    wb_block *block = wb_lookup(pointer, 1);
    return block ? (int)block->capacity : 0;
}

int wb_active_count(void)
{
    int i, count = 0;
    for (i = 0; i < WB_SLOTS; ++i)
        if (wb_blocks[i].active) ++count;
    return count;
}

int wb_invert_rgba(unsigned char *source, unsigned char *destination, int bytes)
{
    wb_block *input = wb_lookup(source, 1);
    wb_block *output = wb_lookup(destination, 1);
    unsigned int i;
    if (bytes <= 0 || (bytes & 3) != 0 || !input || !output ||
        (unsigned int)bytes > input->capacity ||
        (unsigned int)bytes > output->capacity)
        return -1;
    /* Only exact aliasing (in-place) or nonoverlapping allocations are supported. */
    for (i = 0; i < (unsigned int)bytes; i += 4U) {
        destination[i] = (unsigned char)(255U - source[i]);
        destination[i + 1U] = (unsigned char)(255U - source[i + 1U]);
        destination[i + 2U] = (unsigned char)(255U - source[i + 2U]);
        destination[i + 3U] = source[i + 3U];
    }
    return bytes;
}
