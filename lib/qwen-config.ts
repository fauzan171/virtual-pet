const TRUSTED_GATEWAY_SUFFIXES = ['.maas.aliyuncs.com', '.dashscope.aliyuncs.com'];

export function trustedQwenBaseUrl(raw: string | undefined): string {
  if (!raw) throw new Error('Qwen gateway not configured');
  const url = new URL(raw);
  const trustedHost = TRUSTED_GATEWAY_SUFFIXES.some((suffix) => url.hostname.endsWith(suffix));
  if (url.protocol !== 'https:' || !trustedHost || url.username || url.password) {
    throw new Error('Untrusted Qwen gateway URL');
  }
  return url.toString().replace(/\/$/, '');
}

export function isTrustedQwenBaseUrl(raw: string | undefined): boolean {
  try {
    trustedQwenBaseUrl(raw);
    return true;
  } catch {
    return false;
  }
}
