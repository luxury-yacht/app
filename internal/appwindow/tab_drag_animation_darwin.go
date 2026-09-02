//go:build darwin && cgo && !ios && !server

package appwindow

/*
#cgo CFLAGS: -mmacosx-version-min=12.0 -x objective-c
#cgo LDFLAGS: -framework Cocoa -framework WebKit

#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>
#include <stdlib.h>

static NSString *const dockableTabDragPasteboardType =
	@"application/x-luxury-yacht-tab-dockable-tab";
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

static BOOL pasteboardContainsDockableTabMarker(id pasteboard) {
	if ([pasteboard respondsToSelector:@selector(types)] &&
		[[pasteboard types] containsObject:dockableTabDragPasteboardType]) {
		return YES;
	}
	// WebKit wraps nonstandard DataTransfer types in this binary envelope
	// instead of exposing the original MIME string as an NSPasteboardType.
	if (![pasteboard respondsToSelector:@selector(dataForType:)]) {
		return NO;
	}
	NSData *customData = [pasteboard dataForType:webKitCustomPasteboardDataType];
	NSData *markerData = [dockableTabDragPasteboardType
		dataUsingEncoding:NSUTF8StringEncoding];
	if (customData == nil || markerData == nil || markerData.length == 0) {
		return NO;
	}
	return [customData rangeOfData:markerData
		options:0
		range:NSMakeRange(0, customData.length)].location != NSNotFound;
}

static BOOL isDockableTabDraggingSession(id session) {
	if (![session respondsToSelector:@selector(draggingPasteboard)]) {
		return NO;
	}
	return pasteboardContainsDockableTabMarker([session draggingPasteboard]);
}

static void applyDockableTabDragSessionPolicy(id session) {
	if (isDockableTabDraggingSession(session) &&
		[session respondsToSelector:@selector(setAnimatesToStartingPositionsOnCancelOrFail:)]) {
		[session setAnimatesToStartingPositionsOnCancelOrFail:NO];
	}
}

static void dockableTabDraggingSessionWillBegin(
	id receiver,
	SEL selector,
	NSDraggingSession *session,
	NSPoint screenPoint
) {
	if (originalDraggingSessionWillBegin != NULL) {
		originalDraggingSessionWillBegin(receiver, selector, session, screenPoint);
	}
	applyDockableTabDragSessionPolicy(session);
}

@interface DockableTabDragSourceCallbackEncoding : NSObject
- (void)draggingSession:(NSDraggingSession *)session
	willBeginAtPoint:(NSPoint)screenPoint;
@end

@implementation DockableTabDragSourceCallbackEncoding
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
		[DockableTabDragSourceCallbackEncoding class],
		selector
	);
	if (callbackEncodingMethod == NULL) {
		return NO;
	}
	Method inheritedOrOwned = class_getInstanceMethod(webViewClass, selector);
	IMP current = inheritedOrOwned == NULL
		? NULL
		: method_getImplementation(inheritedOrOwned);
	if (current == (IMP)dockableTabDraggingSessionWillBegin) {
		return YES;
	}
	const char *encoding = method_getTypeEncoding(callbackEncodingMethod);
	if (class_addMethod(
		webViewClass,
		selector,
		(IMP)dockableTabDraggingSessionWillBegin,
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
	method_setImplementation(owned, (IMP)dockableTabDraggingSessionWillBegin);
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

@interface DockableTabDragPasteboardProbe : NSObject
@property(nonatomic, retain) NSArray<NSPasteboardType> *types;
@property(nonatomic, retain) NSData *customData;
@end

@implementation DockableTabDragPasteboardProbe
- (NSData *)dataForType:(NSPasteboardType)type {
	return [type isEqualToString:webKitCustomPasteboardDataType] ? self.customData : nil;
}
- (void)dealloc {
	self.types = nil;
	self.customData = nil;
	[super dealloc];
}
@end

@interface DockableTabDragSessionProbe : NSObject
@property(nonatomic, retain) DockableTabDragPasteboardProbe *draggingPasteboard;
@property(nonatomic) BOOL animatesToStartingPositionsOnCancelOrFail;
@end

@implementation DockableTabDragSessionProbe
- (void)dealloc {
	self.draggingPasteboard = nil;
	[super dealloc];
}
@end

static DockableTabDragSessionProbe *newSessionProbe(
	NSArray<NSPasteboardType> *types,
	NSData *customData
) {
	DockableTabDragPasteboardProbe *pasteboard =
		[[DockableTabDragPasteboardProbe alloc] init];
	pasteboard.types = types;
	pasteboard.customData = customData;
	DockableTabDragSessionProbe *session = [[DockableTabDragSessionProbe alloc] init];
	session.draggingPasteboard = pasteboard;
	session.animatesToStartingPositionsOnCancelOrFail = YES;
	[pasteboard release];
	return session;
}

static BOOL callbackSuppressesSession(DockableTabDragSessionProbe *session) {
	DraggingSessionWillBegin savedOriginal = originalDraggingSessionWillBegin;
	originalDraggingSessionWillBegin = NULL;
	dockableTabDraggingSessionWillBegin(
		nil,
		@selector(draggingSession:willBeginAtPoint:),
		(id)session,
		NSZeroPoint
	);
	originalDraggingSessionWillBegin = savedOriginal;
	return !session.animatesToStartingPositionsOnCancelOrFail;
}

static bool native_tab_drag_snap_back_policy_probe(void) {
	DockableTabDragSessionProbe *dockable = newSessionProbe(
		@[dockableTabDragPasteboardType],
		nil
	);
	DockableTabDragSessionProbe *unrelated = newSessionProbe(
		@[@"application/x-luxury-yacht-unrelated-drag"],
		nil
	);
	BOOL passed = callbackSuppressesSession(dockable) &&
		!callbackSuppressesSession(unrelated);
	[dockable release];
	[unrelated release];
	return passed;
}

static bool native_tab_drag_snap_back_policy_installed(void) {
	SEL selector = @selector(draggingSession:willBeginAtPoint:);
	return installedDraggingSessionWillBegin &&
		class_getMethodImplementation([WKWebView class], selector) ==
		(IMP)dockableTabDraggingSessionWillBegin;
}

static bool native_tab_drag_webkit_custom_data_policy_probe(void) {
	NSData *dockableData = [[NSString stringWithFormat:
		@"binary-prefix-%@-binary-suffix",
		dockableTabDragPasteboardType] dataUsingEncoding:NSUTF8StringEncoding];
	DockableTabDragSessionProbe *dockable = newSessionProbe(
		@[webKitCustomPasteboardDataType, @"Apple WebKit dummy pasteboard type"],
		dockableData
	);
	DockableTabDragSessionProbe *unrelated = newSessionProbe(
		@[webKitCustomPasteboardDataType, @"Apple WebKit dummy pasteboard type"],
		[@"unrelated-custom-data" dataUsingEncoding:NSUTF8StringEncoding]
	);
	BOOL passed = callbackSuppressesSession(dockable) &&
		!callbackSuppressesSession(unrelated);
	[dockable release];
	[unrelated release];
	return passed;
}
*/
import "C"

func configureNativeTabDragAnimation() {
	C.configure_native_tab_drag_animation()
}

func nativeTabDragSnapBackPolicyProbe() bool {
	return bool(C.native_tab_drag_snap_back_policy_probe())
}

func nativeTabDragSnapBackPolicyInstalled() bool {
	return bool(C.native_tab_drag_snap_back_policy_installed())
}

func nativeTabDragWebKitCustomDataPolicyProbe() bool {
	return bool(C.native_tab_drag_webkit_custom_data_policy_probe())
}
