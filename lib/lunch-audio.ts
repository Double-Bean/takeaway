// Normalize browser-specific recorder containers for DashScope's WAV input.
export async function toSpeechWav(recording:Blob) {
  const decoder=new AudioContext();
  let source:AudioBuffer;
  try {
    source=await decoder.decodeAudioData(await recording.arrayBuffer());
  } finally {
    await decoder.close();
  }
  if (!source.length || source.duration>31) throw new Error("录音时长异常，请重新录制。");

  const rate=16_000;
  const renderer=new OfflineAudioContext(1,Math.ceil(source.duration*rate),rate);
  const input=renderer.createBufferSource();
  input.buffer=source;
  input.connect(renderer.destination);
  input.start();
  const samples=(await renderer.startRendering()).getChannelData(0);
  const data=new ArrayBuffer(44+samples.length*2);
  const view=new DataView(data);
  const tag=(offset:number,value:string)=>Array.from(value).forEach((letter,index)=>view.setUint8(offset+index,letter.charCodeAt(0)));
  tag(0,"RIFF");
  view.setUint32(4,data.byteLength-8,true);
  tag(8,"WAVE");
  tag(12,"fmt ");
  view.setUint32(16,16,true);
  view.setUint16(20,1,true);
  view.setUint16(22,1,true);
  view.setUint32(24,rate,true);
  view.setUint32(28,rate*2,true);
  view.setUint16(32,2,true);
  view.setUint16(34,16,true);
  tag(36,"data");
  view.setUint32(40,samples.length*2,true);
  for(let index=0;index<samples.length;index++) {
    const sample=Math.min(1,Math.max(-1,samples[index]));
    view.setInt16(44+index*2,sample*(sample<0?32768:32767),true);
  }
  return new File([data],"lunch.wav",{type:"audio/wav"});
}
