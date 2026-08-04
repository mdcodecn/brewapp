package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa
#import <Cocoa/Cocoa.h>
#import <dispatch/dispatch.h>

static void wails_hide_traffic_lights_once(void) {
	@autoreleasepool {
		for (NSWindow *win in [NSApp windows]) {
			if (win == nil) continue;
			[[win standardWindowButton:NSWindowCloseButton] setHidden:YES];
			[[win standardWindowButton:NSWindowMiniaturizeButton] setHidden:YES];
			[[win standardWindowButton:NSWindowZoomButton] setHidden:YES];
		}
	}
}

static void wails_hide_traffic_lights(void) {
	// All AppKit calls must happen on the main thread (startup runs on a Go goroutine).
	// Hide immediately via the main queue, then again shortly after to cover any
	// deferred button setup.
	dispatch_async(dispatch_get_main_queue(), ^{
		wails_hide_traffic_lights_once();
	});
	dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.5 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
		wails_hide_traffic_lights_once();
	});
}
*/
import "C"

// hideSystemTrafficLights hides the standard macOS window controls
// (red/yellow/green traffic lights) so the custom ones in the sidebar take
// over, while keeping the titled window (needed for rounded corners).
func hideSystemTrafficLights() {
	C.wails_hide_traffic_lights()
}
