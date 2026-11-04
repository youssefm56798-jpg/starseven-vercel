import NotFoundView from '../_views/not-found.js';

// Explicit locale for matched English resource routes that call notFound().
// Server document 404 responses in Next 15.5.23 still require hydration to show
// this boundary. Do not describe this as a no-JavaScript fix for matched routes.
export default function EnglishNotFound() {
  return <NotFoundView lang="en" />;
}
