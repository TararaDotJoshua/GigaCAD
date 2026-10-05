/**
 * Set for the browser session when someone dismisses the storage warning. Kept out of the
 * client component, because a server module importing it from there gets a reference, not the string.
 */
export const STORAGE_BANNER_COOKIE = 'gigacad-storage-banner';
