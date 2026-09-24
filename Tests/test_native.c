/* Portable C source self-test; actual XP validation uses the managed CLI runner. */
#include <stdio.h>
#include "../Core/image.h"

int main(void)
{
    unsigned char *p = wb_rgba_buffer();
    unsigned int i;
    const unsigned char sample[8] = { 1, 2, 3, 4, 200, 100, 0, 128 };
    const unsigned char expected[8] = { 254, 253, 252, 4, 55, 155, 255, 128 };
    if (!p || wb_rgba_capacity() != 1048576 ||
        wb_rgba_invert(0, 1) != -1 || wb_rgba_invert(513, 1) != -1)
        return 1;
    for (i = 0; i < 8; ++i) p[i] = sample[i];
    if (wb_rgba_invert(2, 1) != 8) return 2;
    for (i = 0; i < 8; ++i)
        if (p[i] != expected[i]) return 3;
    puts("PASS: portable native C RGBA8 inversion, alpha and bounds checked.");
    return 0;
}
