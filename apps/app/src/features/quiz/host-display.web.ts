export async function showFullScreen() {
  if (!document.documentElement.requestFullscreen)
    throw new Error(
      'Full screen is not available in this browser. Maximize the browser window instead.',
    );
  await document.documentElement.requestFullscreen();
}
