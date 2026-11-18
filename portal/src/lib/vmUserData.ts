// What the server accepts for cloud-init user data (titan-ops features/vm/design.md#vm-create-flow,
// CreateVmValidator): bytes of UTF-8, not JS string length (UTF-16 code units) or Unicode code points.
export const USER_DATA_MAX_BYTES = 32768

export function userDataByteLength(text: string): number {
  return new TextEncoder().encode(text).length
}
