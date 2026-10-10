import type { DocumentPickerAsset } from 'expo-document-picker';

export function releaseFile(asset: DocumentPickerAsset) {
  if (asset.uri.startsWith('blob:')) URL.revokeObjectURL(asset.uri);
}

export function appendFile(form: FormData, asset: DocumentPickerAsset) {
  if (!asset.file) throw new Error('The browser could not read this file. Choose it again.');
  form.append('file', asset.file, asset.name);
}
