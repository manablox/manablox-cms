# `@manablox/media`

Uploads and images.

When a file is uploaded, this package:

1. checks its type and size against what the space allows,
2. hands the bytes to the storage (`@manablox/storage`),
3. saves an asset record with its name, size and image dimensions.

Images are resized and converted (for example to WebP or AVIF) with sharp, in the sizes
your config defines as presets, like `thumb` or `hero`. Editors can also crop, rotate
and adjust images in the admin.

Resize URLs are signed. A visitor cannot request any size they like and make the server
do endless work.

## Do I need to install it?

Usually not. `@manablox/server` installs and uses it for you. You only import it
directly when you build your own server setup or a plugin that needs it.

## Main exports

- `MediaService`: upload, update, edit (crop, rotate, adjust), schedule and delete files and images.
- `signTransform(secret, request)`, `verifyTransform(...)`: sign and check image resize URLs.
- `absoluteMediaUrl(url, base)`: turns a file path into a full URL.
- `validateImageEdits(...)`, `readImageEdits(...)`: check and read the crop, rotation and adjustments of an image.
