declare module 'buffer-crc32' {
  interface ICRC32 {
    (input: Buffer | string, previous?: Buffer | number): Buffer
    signed(input: Buffer | string, previous?: Buffer | number): number
    unsigned(input: Buffer | string, previous?: Buffer | number): number
  }

  const crc32: ICRC32
  export = crc32
}
