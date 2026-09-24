/* Portable C allocator test; actual XP validation uses the managed CLI. */
#include <stdio.h>
#include "../Core/buffers.h"
int main(void) {
    unsigned char *a=wb_alloc(8), *b=wb_alloc(8), *c=wb_alloc(8);
    int i;
    const unsigned char sample[8]={1,2,3,4,200,100,0,128};
    const unsigned char expected[8]={254,253,252,4,55,155,255,128};
    if(!a||!b||!c||a==b||a==c||b==c||wb_active_count()!=3) return 1;
    for(i=0;i<8;i++)a[i]=sample[i];
    if(wb_invert_rgba(a,b,8)!=8 || wb_capacity(a)<8 ||
       wb_invert_rgba(a,b,7)!=-1) return 2;
    for(i=0;i<8;i++)if(b[i]!=expected[i])return 3;
    if(!wb_free(b)||wb_free(b)||wb_invert_rgba(a,b,8)!=-1) return 4;
    if(!wb_free(a)||!wb_free(c)||wb_active_count()!=0) return 5;
    puts("PASS: native multi-buffer allocation, RGB inversion, alpha preservation, release and bounds");
    return 0;
}
