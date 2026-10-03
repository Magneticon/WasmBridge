#ifndef WASMBRIDGE_BUFFERS_H
#define WASMBRIDGE_BUFFERS_H
#include <stdint.h>
#ifdef _WIN32
# define WB_BUFFER_EXPORT __declspec(dllexport)
#else
# define WB_BUFFER_EXPORT
#endif
#ifdef __cplusplus
extern "C" {
#endif

/*
 * Buffer ABI used by both the XP native library and WebAssembly modules.
 *
 * Pointers use the target's native address width. wasm32 therefore exports i32
 * pointers while wasm64/memory64 exports i64 pointers. Buffer sizes stay
 * 32-bit for native and wasm32 compatibility and become 64-bit for wasm64.
 * There is no WasmBridge-imposed memory or allocation-count ceiling; failure is
 * reported when the host allocator/address space or WebAssembly memory cannot
 * satisfy a request.
 */
#if defined(__wasm64__)
typedef uint64_t wb_size_t;
#else
typedef uint32_t wb_size_t;
#endif

WB_BUFFER_EXPORT unsigned char *wb_alloc(wb_size_t bytes);
WB_BUFFER_EXPORT int wb_free(unsigned char *pointer);
WB_BUFFER_EXPORT wb_size_t wb_capacity(unsigned char *pointer);
WB_BUFFER_EXPORT wb_size_t wb_invert_rgba(unsigned char *source, unsigned char *destination, wb_size_t bytes);
WB_BUFFER_EXPORT uint32_t wb_active_count(void);
WB_BUFFER_EXPORT uint32_t wb_address_bits(void);

#ifdef __cplusplus
}
#endif
#endif
