"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.createSkiaFrameProcessor = createSkiaFrameProcessor;
exports.useSkiaFrameProcessor = useSkiaFrameProcessor;
var _react = require("react");
var _WorkletsProxy = require("../dependencies/WorkletsProxy");
var _SkiaProxy = require("../dependencies/SkiaProxy");
var _withFrameRefCounting = require("../frame-processors/withFrameRefCounting");
var _VisionCameraProxy = require("../frame-processors/VisionCameraProxy");
/**
 * Represents a Camera Frame that can be directly drawn to using Skia.
 *
 * @see {@linkcode useSkiaFrameProcessor}
 * @see {@linkcode render}
 */

function getDegrees(orientation) {
  'worklet';

  switch (orientation) {
    case 'portrait':
      return 0;
    case 'landscape-left':
      return 90;
    case 'portrait-upside-down':
      return 180;
    case 'landscape-right':
      return 270;
  }
}
function getOrientation(degrees) {
  'worklet';

  const clamped = (degrees + 360) % 360;
  if (clamped >= 315 || clamped <= 45) return 'portrait';else if (clamped >= 45 && clamped <= 135) return 'landscape-left';else if (clamped >= 135 && clamped <= 225) return 'portrait-upside-down';else if (clamped >= 225 && clamped <= 315) return 'landscape-right';else throw new Error(`Invalid degrees! ${degrees}`);
}
function relativeTo(a, b) {
  'worklet';

  return getOrientation(getDegrees(a) - getDegrees(b));
}

/**
 * Counter-rotates the {@linkcode canvas} by the {@linkcode frame}'s {@linkcode Frame.orientation orientation}
 * to ensure the Frame will be drawn upright.
 */
function withRotatedFrame(frame, canvas, previewOrientation, func) {
  'worklet';

  // 1. save current translation matrix
  canvas.save();
  try {
    // 2. properly rotate canvas so Frame is rendered up-right.
    const orientation = relativeTo(frame.orientation, previewOrientation);
    switch (orientation) {
      case 'portrait':
        // do nothing
        break;
      case 'landscape-left':
        // rotate two flips on (0,0) origin and move X + Y into view again
        canvas.scale(1, -1);
        canvas.translate(frame.height, -frame.width);
        canvas.rotate(90, 0, 0);
        break;
      case 'portrait-upside-down':
        // rotate three flips on (0,0) origin and move Y into view again
        canvas.translate(frame.width, frame.height);
        canvas.rotate(180, 0, 0);
        break;
      case 'landscape-right':
        // rotate one flip on (0,0) origin and move X into view again
        canvas.translate(frame.height, 0);
        canvas.rotate(90, 0, 0);
        break;
      default:
        throw new Error(`Invalid frame.orientation: ${frame.orientation}!`);
    }

    // 3. call actual processing code
    func();
  } finally {
    // 4. restore matrix again to original base
    canvas.restore();
  }
}
/**
 * Get the size of the surface that will be used for rendering, which already accounts
 * for the Frame's {@linkcode Frame.orientation orientation}.
 */
function getSurfaceSize(frame) {
  'worklet';

  switch (frame.orientation) {
    case 'portrait':
    case 'portrait-upside-down':
      return {
        width: frame.width,
        height: frame.height
      };
    case 'landscape-left':
    case 'landscape-right':
      return {
        width: frame.height,
        height: frame.width
      };
  }
}

/**
 * Create a new Frame Processor function which you can pass to the `<Camera>`.
 * (See ["Frame Processors"](https://react-native-vision-camera.com/docs/guides/frame-processors))
 *
 * Make sure to add the `'worklet'` directive to the top of the Frame Processor function, otherwise it will not get compiled into a worklet.
 *
 * Also make sure to memoize the returned object, so that the Camera doesn't reset the Frame Processor Context each time.
 *
 * @worklet
 * @example
 * ```ts
 * const surfaceHolder = Worklets.createSharedValue<SurfaceCache>({})
 * const offscreenTextures = Worklets.createSharedValue<SkImage[]>([])
 * const frameProcessor = createSkiaFrameProcessor((frame) => {
 *   'worklet'
 *   const faces = scanFaces(frame)
 *
 *   frame.render()
 *   for (const face of faces) {
 *     const rect = Skia.XYWHRect(face.x, face.y, face.width, face.height)
 *     frame.drawRect(rect)
 *   }
 * }, surfaceHolder, offscreenTextures)
 * ```
 */
function createSkiaFrameProcessor(frameProcessor, surfaceHolder, offscreenTextures, previewOrientation) {
  const Skia = _SkiaProxy.SkiaProxy.Skia;
  const Worklets = _WorkletsProxy.WorkletsProxy.Worklets;
  const getSkiaSurface = frame => {
    'worklet';

    // 1. The Frame Processor runs on an iOS `DispatchQueue`, which might use
    //    multiple C++ Threads between runs (it's still serial though - not concurrent!)
    // 2. react-native-skia uses `thread_local` Skia Contexts (`GrDirectContext`),
    //    which means if a new Thread calls a Skia method, it also uses a new
    //    Skia Context.
    //
    // This will cause issues if we cache the `SkSurface` between renders,
    // as the next render might be on a different C++ Thread.
    // When the next render uses a different C++ Thread, it will also use a
    // different Skia Context (`GrDirectContext`) for creating the SkImage,
    // than the one used for creating the `SkSurface` in the first render.
    // This will cause the render to fail, as an SkImage can only be rendered
    // to an SkSurface if both were created on the same Skia Context.
    // To prevent this, we cache the SkSurface on a per-thread basis,
    // so in my tests the DispatchQueue uses up to 10 different Threads,
    // causing 10 different Surfaces to exist in memory.
    // A true workaround would be to expose Skia Contexts to JS in RN Skia,
    // but for now this is fine.
    const threadId = Worklets.getCurrentThreadId();
    const size = getSurfaceSize(frame);
    if (surfaceHolder.value[threadId] == null || surfaceHolder.value[threadId].width !== size.width || surfaceHolder.value[threadId].height !== size.height) {
      const surface = Skia.Surface.MakeOffscreen(size.width, size.height);
      if (surface == null) {
        // skia surface couldn't be allocated
        throw new Error(`Failed to create ${size.width}x${size.height} Skia Surface!`);
      }
      surfaceHolder.value[threadId]?.surface.dispose();
      delete surfaceHolder.value[threadId];
      surfaceHolder.value[threadId] = {
        surface: surface,
        width: size.width,
        height: size.height
      };
    }
    const surface = surfaceHolder.value[threadId].surface;
    return surface;
  };
  const createDrawableProxy = (frame, canvas) => {
    'worklet';

    // Convert Frame to SkImage/Texture
    const nativeBuffer = frame.getNativeBuffer();
    const image = Skia.Image.MakeImageFromNativeBuffer(nativeBuffer.pointer);

    // Creates a `Proxy` that holds the SkCanvas, but also adds additional methods such as render() and dispose().
    const canvasProxy = new Proxy(canvas, {
      get(_, property) {
        switch (property) {
          case '__skImage':
            return image;
          case 'render':
            return paint => {
              'worklet';

              if (paint != null) canvas.drawImage(image, 0, 0, paint);else canvas.drawImage(image, 0, 0);
            };
          case 'dispose':
            return () => {
              'worklet';

              // dispose the Frame and the SkImage/Texture
              image.dispose();
              nativeBuffer.delete();
            };
        }
        return canvas[property];
      }
    });
    return frame.withBaseClass(canvasProxy);
  };
  return {
    frameProcessor: (0, _withFrameRefCounting.withFrameRefCounting)(frame => {
      'worklet';

      // 1. Set up Skia Surface with size of Frame
      const surface = getSkiaSurface(frame);

      // 2. Create DrawableFrame proxy which internally creates an SkImage/Texture
      const canvas = surface.getCanvas();
      const drawableFrame = createDrawableProxy(frame, canvas);
      try {
        // 3. Clear the current Canvas
        const black = Skia.Color('black');
        canvas.clear(black);

        // 4. rotate the frame properly to make sure it's upright
        withRotatedFrame(frame, canvas, previewOrientation.value, () => {
          // 5. Run any user drawing operations
          frameProcessor(drawableFrame);
        });

        // 6. Flush draw operations and submit to GPU
        surface.flush();
      } finally {
        // 7. Delete the SkImage/Texture that holds the Frame
        drawableFrame.dispose();
      }

      // 8. Capture rendered results as a Texture/SkImage to later render to screen
      const snapshot = surface.makeImageSnapshot();
      const snapshotCopy = snapshot.makeNonTextureImage();
      snapshot.dispose();
      offscreenTextures.value.push(snapshotCopy);

      // 9. Close old textures that are still in the queue.
      while (offscreenTextures.value.length > 1) {
        // shift() atomically removes the first element, and is therefore thread-safe.
        const texture = offscreenTextures.value.shift();
        if (texture == null) break;
        texture.dispose();
      }
    }),
    type: 'drawable-skia',
    offscreenTextures: offscreenTextures,
    previewOrientation: previewOrientation
  };
}

/**
 * Returns a memoized Skia Frame Processor function wich you can pass to the `<Camera>`.
 *
 * The Skia Frame Processor alows you to draw ontop of the Frame, and will manage it's internal offscreen Skia Canvas
 * and onscreen Skia preview view.
 *
 * (See ["Frame Processors"](https://react-native-vision-camera.com/docs/guides/frame-processors))
 *
 * Make sure to add the `'worklet'` directive to the top of the Frame Processor function, otherwise it will not get compiled into a worklet.
 *
 * @worklet
 * @param frameProcessor The Frame Processor
 * @param dependencies The React dependencies which will be copied into the VisionCamera JS-Runtime.
 * @returns The memoized Skia Frame Processor.
 * @example
 * ```ts
 * const frameProcessor = useSkiaFrameProcessor((frame) => {
 *   'worklet'
 *   const faces = scanFaces(frame)
 *
 *   frame.render()
 *   for (const face of faces) {
 *     const rect = Skia.XYWHRect(face.x, face.y, face.width, face.height)
 *     frame.drawRect(rect)
 *   }
 * }, [])
 * ```
 */
function useSkiaFrameProcessor(frameProcessor, dependencies) {
  const surface = _WorkletsProxy.WorkletsProxy.useSharedValue({});
  const offscreenTextures = _WorkletsProxy.WorkletsProxy.useSharedValue([]);
  const previewOrientation = _WorkletsProxy.WorkletsProxy.useSharedValue('portrait');
  (0, _react.useEffect)(() => {
    return () => {
      // on unmount, we clean up the resources on the Worklet Context.
      // this causes it to run _after_ the Frame Processor has finished executing,
      // if it is currently executing - so we avoid race conditions here.
      _VisionCameraProxy.VisionCameraProxy.workletContext?.runAsync(() => {
        'worklet';

        const surfaces = Object.values(surface.value).map(v => v.surface);
        surface.value = {};
        surfaces.forEach(s => s.dispose());
        while (offscreenTextures.value.length > 0) {
          const texture = offscreenTextures.value.shift();
          if (texture == null) break;
          texture.dispose();
        }
      });
    };
  }, [offscreenTextures, surface]);
  return (0, _react.useMemo)(() => createSkiaFrameProcessor(frameProcessor, surface, offscreenTextures, previewOrientation),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  dependencies);
}
//# sourceMappingURL=useSkiaFrameProcessor.js.map