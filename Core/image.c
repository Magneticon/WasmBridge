#include "image.h"

#define WB_MAX_WIDTH 512
#define WB_MAX_HEIGHT 512
#define WB_CAPACITY (WB_MAX_WIDTH * WB_MAX_HEIGHT * 4)

/* Static storage requires no libc or malloc for an MVP Wasm build. */
static unsigned char wb_pixels[WB_CAPACITY];

unsigned char *wb_rgba_buffer(void)
{
    return wb_pixels;
}

int wb_rgba_capacity(void)
{
    return WB_CAPACITY;
}

int wb_rgba_invert(int width, int height)
{
    unsigned int total;
    unsigned int i;
    if (width <= 0 || height <= 0 || width > WB_MAX_WIDTH || height > WB_MAX_HEIGHT)
        return -1;

    total = (unsigned int)width * (unsigned int)height * 4U;
    for (i = 0; i < total; i += 4U)
    {
        wb_pixels[i] = (unsigned char)(255U - wb_pixels[i]);
        wb_pixels[i + 1U] = (unsigned char)(255U - wb_pixels[i + 1U]);
        wb_pixels[i + 2U] = (unsigned char)(255U - wb_pixels[i + 2U]);
        /* Leave alpha at [i + 3] unchanged. */
    }
    return (int)total;
}
