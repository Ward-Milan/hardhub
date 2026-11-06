#import <Cocoa/Cocoa.h>

int extract_mac_app_icon_png(const char *app_path, const char *out_png_path) {
    @autoreleasepool {
        if (!app_path || !out_png_path) return -1;
        NSString *nsAppPath = [NSString stringWithUTF8String:app_path];
        NSString *nsOutPath = [NSString stringWithUTF8String:out_png_path];
        
        NSImage *icon = [[NSWorkspace sharedWorkspace] iconForFile:nsAppPath];
        if (!icon) return -2;
        
        NSSize targetSize = NSMakeSize(64, 64);
        NSBitmapImageRep *rep = [[NSBitmapImageRep alloc]
            initWithBitmapDataPlanes:NULL
            pixelsWide:128
            pixelsHigh:128
            bitsPerSample:8
            samplesPerPixel:4
            hasAlpha:YES
            isPlanar:NO
            colorSpaceName:NSDeviceRGBColorSpace
            bytesPerRow:0
            bitsPerPixel:0];
        rep.size = targetSize;
        
        [NSGraphicsContext saveGraphicsState];
        [NSGraphicsContext setCurrentContext:[NSGraphicsContext graphicsContextWithBitmapImageRep:rep]];
        [icon drawInRect:NSMakeRect(0, 0, 64, 64)];
        [NSGraphicsContext restoreGraphicsState];
        
        NSData *png = [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
        if (!png) return -3;
        
        BOOL ok = [png writeToFile:nsOutPath atomically:YES];
        return ok ? 0 : -4;
    }
}

