// CloudFront Function (viewer-request): map directory-style URLs from the
// Next.js static export onto their index.html objects.
//   /apply/  -> /apply/index.html
//   /apply   -> /apply/index.html
// /api/* never reaches this function (it is only on the default behavior).
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.endsWith("/")) {
    request.uri = uri + "index.html";
  } else if (uri.lastIndexOf(".") < uri.lastIndexOf("/")) {
    request.uri = uri + "/index.html";
  }
  return request;
}
