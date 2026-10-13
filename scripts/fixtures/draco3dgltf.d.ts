// draco3dgltf ships no types; the glTF fixtures only needs the encoder factory.
declare module 'draco3dgltf' {
  const draco3d: {
    createEncoderModule(): Promise<unknown>
    createDecoderModule(): Promise<unknown>
  }
  export default draco3d
}
