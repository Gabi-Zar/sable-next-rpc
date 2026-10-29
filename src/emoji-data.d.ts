declare module 'virtual:sable-emoji-data' {
  export const emoticonEntries: readonly (readonly [emoticon: string, unicode: string])[];
  export const emojiRawRecords: readonly (readonly [
    unicode: string,
    codes: readonly string[],
    keywords: readonly string[],
    groupIndex: number,
  ])[];
}
