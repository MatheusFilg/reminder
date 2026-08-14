const ROUND_PY = `
import ctypes, ctypes.util, sys

X11 = ctypes.CDLL(ctypes.util.find_library("X11"))
Xext = ctypes.CDLL(ctypes.util.find_library("Xext"))

X11.XOpenDisplay.restype = ctypes.c_void_p
X11.XOpenDisplay.argtypes = [ctypes.c_char_p]
X11.XCreatePixmap.restype = ctypes.c_ulong
X11.XCreatePixmap.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_uint, ctypes.c_uint, ctypes.c_uint]
X11.XCreateGC.restype = ctypes.c_void_p
X11.XCreateGC.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_void_p]
X11.XSetForeground.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_ulong]
X11.XFillRectangle.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_uint, ctypes.c_uint]
X11.XFillArc.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_uint, ctypes.c_uint, ctypes.c_int, ctypes.c_int]
X11.XFreeGC.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
X11.XFreePixmap.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
X11.XSync.argtypes = [ctypes.c_void_p, ctypes.c_int]
X11.XCloseDisplay.argtypes = [ctypes.c_void_p]
Xext.XShapeCombineMask.argtypes = [
    ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ulong, ctypes.c_int
]

ShapeBounding, ShapeInput, ShapeSet = 0, 2, 0

dpy = X11.XOpenDisplay(None)
if not dpy:
    sys.exit(1)

win = int(sys.argv[1], 16)
w, h, r = map(int, sys.argv[2:5])
d = r * 2
pm = X11.XCreatePixmap(dpy, win, w, h, 1)
gc = X11.XCreateGC(dpy, pm, 0, None)
X11.XSetForeground(dpy, gc, 0)
X11.XFillRectangle(dpy, pm, gc, 0, 0, w, h)
X11.XSetForeground(dpy, gc, 1)
X11.XFillRectangle(dpy, pm, gc, r, 0, w - d, h)
X11.XFillRectangle(dpy, pm, gc, 0, r, w, h - d)
X11.XFillArc(dpy, pm, gc, 0, 0, d, d, 90 * 64, 90 * 64)
X11.XFillArc(dpy, pm, gc, w - d, 0, d, d, 0, 90 * 64)
X11.XFillArc(dpy, pm, gc, 0, h - d, d, d, 180 * 64, 90 * 64)
X11.XFillArc(dpy, pm, gc, w - d, h - d, d, d, 270 * 64, 90 * 64)
Xext.XShapeCombineMask(dpy, win, ShapeBounding, 0, 0, pm, ShapeSet)
Xext.XShapeCombineMask(dpy, win, ShapeInput, 0, 0, pm, ShapeSet)
X11.XFreeGC(dpy, gc)
X11.XFreePixmap(dpy, pm)
X11.XSync(dpy, 0)
X11.XCloseDisplay(dpy)
`;

function findWindowId(): string | null {
	const result = Bun.spawnSync(["xwininfo", "-name", "Reminder"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const text = `${result.stdout.toString()}${result.stderr.toString()}`;
	return text.match(/Window id:\s+(0x[0-9a-fA-F]+)/i)?.[1] ?? null;
}

export function applyLinuxRoundedCorners(
	width: number,
	height: number,
	radius: number,
) {
	if (process.platform !== "linux") return;
	const id = findWindowId();
	if (!id) return;
	Bun.spawn(
		["/usr/bin/python3", "-c", ROUND_PY, id, String(width), String(height), String(radius)],
		{ stdout: "ignore", stderr: "ignore" },
	);
}
