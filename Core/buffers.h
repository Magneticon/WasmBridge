#ifndef WASMBRIDGE_BUFFERS_H
#define WASMBRIDGE_BUFFERS_H
#ifdef _WIN32
# define WB_BUFFER_EXPORT __declspec(dllexport)
#else
# define WB_BUFFER_EXPORT
#endif
#ifdef __cplusplus
extern "C" {
#endif
/* Stable initial ABI. Wasm pointers are i32 linear-memory offsets; native
   pointers are ordinary process addresses. Input sizes are signed 32-bit.
   NULL/0 means allocation failure; release returns 1 on success, 0 otherwise. */
WB_BUFFER_EXPORT unsigned char *wb_alloc(int bytes);
WB_BUFFER_EXPORT int wb_free(unsigned char *pointer);
WB_BUFFER_EXPORT int wb_capacity(unsigned char *pointer);
WB_BUFFER_EXPORT int wb_invert_rgba(unsigned char *source, unsigned char *destination, int bytes);
WB_BUFFER_EXPORT int wb_active_count(void);
#ifdef __cplusplus
}
#endif
#endif
