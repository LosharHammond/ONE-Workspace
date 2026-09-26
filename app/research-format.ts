export function numberedTranscript(text:string){return text.split(/(?<=[.!?])\s+|\n+/).filter(Boolean).map((line,i)=>`[L${i+1}] ${line}`).join('\n')}
