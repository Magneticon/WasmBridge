#ifndef WASMBRIDGE_MATH_H
#define WASMBRIDGE_MATH_H
#ifdef _WIN32
# define WB_EXPORT __declspec(dllexport)
#else
# define WB_EXPORT
#endif
#ifdef __cplusplus
extern "C" {
#endif
/* C integer addition; defined behavior for inputs where the sum fits int32. */
WB_EXPORT int add(int a, int b);
#ifdef __cplusplus
}
#endif
#endif
