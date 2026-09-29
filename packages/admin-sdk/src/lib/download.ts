/** Downloads a generated file. */
export function downloadFile(filename: string, mimeType: string, contents: string): void {
  downloadBlob(filename, new Blob([contents], { type: mimeType }));
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Firefox reads the URL after the click returns.
  requestAnimationFrame(() => URL.revokeObjectURL(url));
}
