import type { DocumentPickerAsset } from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';

/** Only the picker-created cache copy is deleted, never the student's original. */
export function releaseFile(asset: DocumentPickerAsset) {
  if (asset.uri.startsWith(Paths.cache.uri)) {
    const file = new File(asset.uri);
    if (file.exists) file.delete();
  }
}

export function appendFile(form: FormData, asset: DocumentPickerAsset) {
  form.append('file', new File(asset.uri), asset.name);
}
