//go:build darwin && cgo && !ios && !server

package appwindow

import (
	/*
		#cgo CFLAGS: -mmacosx-version-min=12.0 -x objective-c
		#cgo LDFLAGS: -framework Cocoa -framework WebKit

		#import <AppKit/AppKit.h>
		#import <WebKit/WebKit.h>
		#import <objc/runtime.h>
		#include <stdlib.h>

		static NSString *const dockableTabDragPasteboardType =
			@"application/x-luxury-yacht-tab-dockable-tab";
		static NSString *const clusterTabDragPasteboardType =
			@"application/x-luxury-yacht-tab-cluster-tab";
		static NSString *const webKitCustomPasteboardDataType =
			@"com.apple.WebKit.custom-pasteboard-data";

		typedef void (*DraggingSessionWillBegin)(
			id,
			SEL,
			NSDraggingSession *,
			NSPoint
		);

		static DraggingSessionWillBegin originalDraggingSessionWillBegin;
		static BOOL installedDraggingSessionWillBegin;

		static BOOL pasteboardContainsTabMarker(id pasteboard, NSString *marker) {
			if ([pasteboard respondsToSelector:@selector(types)] &&
				[[pasteboard types] containsObject:marker]) {
				return YES;
			}
			// WebKit wraps nonstandard DataTransfer types in this binary envelope
			// instead of exposing the original MIME string as an NSPasteboardType.
			if (![pasteboard respondsToSelector:@selector(dataForType:)]) {
				return NO;
			}
			NSData *customData = [pasteboard dataForType:webKitCustomPasteboardDataType];
			NSData *markerData = [marker
				dataUsingEncoding:NSUTF8StringEncoding];
			if (customData == nil || markerData == nil || markerData.length == 0) {
				return NO;
			}
			return [customData rangeOfData:markerData
				options:0
				range:NSMakeRange(0, customData.length)].location != NSNotFound;
		}

		static BOOL isTabDraggingSession(id session) {
			if (![session respondsToSelector:@selector(draggingPasteboard)]) {
				return NO;
			}
			id pasteboard = [session draggingPasteboard];
			return pasteboardContainsTabMarker(pasteboard, dockableTabDragPasteboardType) ||
				pasteboardContainsTabMarker(pasteboard, clusterTabDragPasteboardType);
		}

		static void applyTabDragSessionPolicy(id session) {
			if (isTabDraggingSession(session) &&
				[session respondsToSelector:@selector(setAnimatesToStartingPositionsOnCancelOrFail:)]) {
				[session setAnimatesToStartingPositionsOnCancelOrFail:NO];
			}
		}

		static void tabDraggingSessionWillBegin(
			id receiver,
			SEL selector,
			NSDraggingSession *session,
			NSPoint screenPoint
		) {
			if (originalDraggingSessionWillBegin != NULL) {
				originalDraggingSessionWillBegin(receiver, selector, session, screenPoint);
			}
			applyTabDragSessionPolicy(session);
		}

		@interface TabDragSourceCallbackEncoding : NSObject
		- (void)draggingSession:(NSDraggingSession *)session
			willBeginAtPoint:(NSPoint)screenPoint;
		@end

		@implementation TabDragSourceCallbackEncoding
		- (void)draggingSession:(NSDraggingSession *)session
			willBeginAtPoint:(NSPoint)screenPoint {
			(void)session;
			(void)screenPoint;
		}
		@end

		static Method classOwnedMethod(Class targetClass, SEL selector) {
			unsigned int count = 0;
			Method *methods = class_copyMethodList(targetClass, &count);
			Method result = NULL;
			for (unsigned int index = 0; index < count; index++) {
				if (method_getName(methods[index]) == selector) {
					result = methods[index];
					break;
				}
			}
			free(methods);
			return result;
		}

		static BOOL installDraggingSessionWillBeginOverride(void) {
			Class webViewClass = [WKWebView class];
			SEL selector = @selector(draggingSession:willBeginAtPoint:);
			Method callbackEncodingMethod = class_getInstanceMethod(
				[TabDragSourceCallbackEncoding class],
				selector
			);
			if (callbackEncodingMethod == NULL) {
				return NO;
			}
			Method inheritedOrOwned = class_getInstanceMethod(webViewClass, selector);
			IMP current = inheritedOrOwned == NULL
				? NULL
				: method_getImplementation(inheritedOrOwned);
			if (current == (IMP)tabDraggingSessionWillBegin) {
				return YES;
			}
			const char *encoding = method_getTypeEncoding(callbackEncodingMethod);
			if (class_addMethod(
				webViewClass,
				selector,
				(IMP)tabDraggingSessionWillBegin,
				encoding
			)) {
				originalDraggingSessionWillBegin = (DraggingSessionWillBegin)current;
				return YES;
			}
			Method owned = classOwnedMethod(webViewClass, selector);
			if (owned == NULL) {
				return NO;
			}
			originalDraggingSessionWillBegin =
				(DraggingSessionWillBegin)method_getImplementation(owned);
			method_setImplementation(owned, (IMP)tabDraggingSessionWillBegin);
			return YES;
		}

		static void configure_native_tab_drag_animation(void) {
			@synchronized([WKWebView class]) {
				if (installedDraggingSessionWillBegin) {
					return;
				}
				// The drag-source callback is the first stable seam that receives the
				// populated session regardless of WebKit's internal session-creation path.
				installedDraggingSessionWillBegin =
					installDraggingSessionWillBeginOverride();
			}
		}

		@interface TabDragPasteboardProbe : NSObject
		@property(nonatomic, retain) NSArray<NSPasteboardType> *types;
		@property(nonatomic, retain) NSData *customData;
		@end

		@implementation TabDragPasteboardProbe
		- (NSData *)dataForType:(NSPasteboardType)type {
			return [type isEqualToString:webKitCustomPasteboardDataType] ? self.customData : nil;
		}
		- (void)dealloc {
			self.types = nil;
			self.customData = nil;
			[super dealloc];
		}
		@end

		@interface TabDragSessionProbe : NSObject
		@property(nonatomic, retain) TabDragPasteboardProbe *draggingPasteboard;
		@property(nonatomic) BOOL animatesToStartingPositionsOnCancelOrFail;
		@end

		@implementation TabDragSessionProbe
		- (void)dealloc {
			self.draggingPasteboard = nil;
			[super dealloc];
		}
		@end

		static TabDragSessionProbe *newSessionProbe(
			NSArray<NSPasteboardType> *types,
			NSData *customData
		) {
			TabDragPasteboardProbe *pasteboard =
				[[TabDragPasteboardProbe alloc] init];
			pasteboard.types = types;
			pasteboard.customData = customData;
			TabDragSessionProbe *session = [[TabDragSessionProbe alloc] init];
			session.draggingPasteboard = pasteboard;
			session.animatesToStartingPositionsOnCancelOrFail = YES;
			[pasteboard release];
			return session;
		}

		static BOOL callbackSuppressesSession(TabDragSessionProbe *session) {
			DraggingSessionWillBegin savedOriginal = originalDraggingSessionWillBegin;
			originalDraggingSessionWillBegin = NULL;
			tabDraggingSessionWillBegin(
				nil,
				@selector(draggingSession:willBeginAtPoint:),
				(id)session,
				NSZeroPoint
			);
			originalDraggingSessionWillBegin = savedOriginal;
			return !session.animatesToStartingPositionsOnCancelOrFail;
		}

		static bool native_tab_drag_snap_back_policy_probe(
			const char *mimeType,
			bool webKitCustomData
		) {
			NSString *marker = [NSString stringWithUTF8String:mimeType];
			NSArray<NSPasteboardType> *types = @[marker];
			NSData *customData = nil;
			if (webKitCustomData) {
				types = @[webKitCustomPasteboardDataType, @"Apple WebKit dummy pasteboard type"];
				customData = [[NSString stringWithFormat:
					@"binary-prefix-%@-binary-suffix", marker] dataUsingEncoding:NSUTF8StringEncoding];
			}
			TabDragSessionProbe *session = newSessionProbe(types, customData);
			BOOL suppressed = callbackSuppressesSession(session);
			[session release];
			return suppressed;
		}

		static bool native_tab_drag_snap_back_policy_installed(void) {
			SEL selector = @selector(draggingSession:willBeginAtPoint:);
			return installedDraggingSessionWillBegin &&
				class_getMethodImplementation([WKWebView class], selector) ==
				(IMP)tabDraggingSessionWillBegin;
		}

	*/
	"C"

	"unsafe"
)

func configureNativeTabDragAnimation() {
	C.configure_native_tab_drag_animation()
}

func nativeTabDragSnapBackPolicyProbe(mimeType string, webKitCustomData bool) bool {
	marker := C.CString(mimeType)
	defer C.free(unsafe.Pointer(marker))
	return bool(C.native_tab_drag_snap_back_policy_probe(marker, C.bool(webKitCustomData)))
}

func nativeTabDragSnapBackPolicyInstalled() bool {
	return bool(C.native_tab_drag_snap_back_policy_installed())
}
