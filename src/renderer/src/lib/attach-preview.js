import { toast } from 'sonner';

/**
 * The app's one "make this file the project's preview" flow: validate the
 * format, hand the path to the main process (which keeps a `<Set Name>.mp3`
 * listening copy in the captures folder), and say what happened. Both ways in
 * - dropping a file onto a card and "Add audio…" - go through here.
 */
export async function attachPreview(api, key, srcPath, displayName) {
  const name = String(srcPath || '').split(/[\\/]/).pop();
  if (!/\.(mp3|wav)$/i.test(name)) {
    toast.error('Only WAV or MP3', {
      description: `“${name || 'That file'}” isn’t a format the app can take - use a bounce instead.`,
    });
    return { error: 'unsupported format' };
  }
  const id = toast.loading('Getting your file ready…');
  const res = await api.dropPreview(key, srcPath);
  if (res && res.error) {
    toast.error('That file didn’t work', { id, description: res.error });
  } else if (res && res.unchanged) {
    toast.info('Already the preview', {
      id,
      description: `${res.previewName} is already what plays for this project.`,
    });
  } else {
    toast.success('New preview set', {
      id,
      description: `${res.previewName} now plays for “${displayName || 'this project'}”.`,
    });
  }
  return res;
}
