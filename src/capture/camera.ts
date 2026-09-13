/**
 * Rear camera and torch.
 *
 * Torch control is a MediaStreamTrack constraint ({ torch: true }), advertised through
 * track.getCapabilities(). Chrome on Android supports it; iOS Safari support has varied between
 * versions. Every step is feature-detected and failure is non-fatal: if the torch cannot be
 * switched on, the UI asks the user to turn on the flashlight from Control Center, or to capture
 * in bright light.
 */

export type TorchState = 'on' | 'off' | 'unsupported' | 'failed';

export type CameraErrorCode = 'insecure-context' | 'not-supported' | 'permission-denied' | 'not-found' | 'in-use' | 'unknown';

export class CameraError extends Error {
  constructor(public code: CameraErrorCode, public problem: string, public fix: string) {
    super(problem);
  }
}

export interface CameraSession {
  stream: MediaStream;
  track: MediaStreamTrack;
  video: HTMLVideoElement;
  torch: TorchState;
  settings: MediaTrackSettings;
  label: string;
  setTorch(on: boolean): Promise<TorchState>;
  stop(): void;
}

function mapError(err: unknown): CameraError {
  const name = err instanceof DOMException ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new CameraError('permission-denied', 'Camera access was blocked.',
        'Allow camera access for this site in your browser settings (on iPhone: Settings → Safari → Camera), then reload the page.');
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new CameraError('not-found', 'No usable camera was found on this device.',
        'Use a phone with a rear camera, or try a demo case instead.');
    case 'NotReadableError':
    case 'AbortError':
      return new CameraError('in-use', 'The camera is being used by another app.',
        'Close other apps that use the camera, then try again.');
    default:
      return new CameraError('unknown', 'The camera could not be started.',
        'Reload the page and try again. If it keeps failing, try a different browser.');
  }
}

export async function openCamera(video: HTMLVideoElement): Promise<CameraSession> {
  if (!window.isSecureContext) {
    throw new CameraError('insecure-context', 'This page was opened over an insecure connection, so the browser blocks the camera.',
      'Open the https:// address instead of http://.');
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraError('not-supported', 'This browser does not support camera access.',
      'Open the page in Safari on iPhone or Chrome on Android.');
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 30 },
      },
    });
  } catch (err) {
    throw mapError(err);
  }

  const track = stream.getVideoTracks()[0];
  // iOS requires inline, muted playback for a camera stream to render without fullscreen
  video.setAttribute('playsinline', '');
  video.muted = true;
  video.srcObject = stream;
  try {
    await video.play();
  } catch {
    // Autoplay can be refused if not triggered by a gesture; the caller starts capture from a tap.
  }

  const setTorch = async (on: boolean): Promise<TorchState> => {
    const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
    if (!caps.torch) return 'unsupported';
    try {
      await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
      const s = track.getSettings() as MediaTrackSettings & { torch?: boolean };
      if (s.torch === undefined) return on ? 'on' : 'off';
      return s.torch === on ? (on ? 'on' : 'off') : 'failed';
    } catch {
      return 'failed';
    }
  };

  const session: CameraSession = {
    stream,
    track,
    video,
    torch: 'off',
    settings: track.getSettings(),
    label: track.label,
    setTorch,
    stop() {
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    },
  };
  session.torch = await setTorch(true);
  session.settings = track.getSettings();
  return session;
}
