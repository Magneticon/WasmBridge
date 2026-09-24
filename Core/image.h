#ifndef WASMBRIDGE_IMAGE_H
#define WASMBRIDGE_IMAGE_H

#ifdef _WIN32
# define WB_IMAGE_EXPORT __declspec(dllexport)
#else
# define WB_IMAGE_EXPORT
#endif

#ifdef __cplusplus
extern "C" {
#endif

/* v0.2 RGBA8 ABI: 512x512 max, 4-byte pixels, tightly packed, row-major.
   Buffer is module-owned scratch space reused by each synchronous call.
   wb_rgba_buffer() returns a pointer (wasm32 offset or native address).
   Caller checks capacity and copies width * height * 4 bytes before and
   after wb_rgba_invert(). Return is processed bytes, or -1 on invalid size.
   Alpha is preserved. There is no allocation/free operation in this ABI. */
WB_IMAGE_EXPORT unsigned char *wb_rgba_buffer(void);
WB_IMAGE_EXPORT int wb_rgba_capacity(void);
WB_IMAGE_EXPORT int wb_rgba_invert(int width, int height);

#ifdef __cplusplus
}
#endif
#endif
