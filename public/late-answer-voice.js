'use strict';
window.LateAnswerVoice = class {
  constructor(send, report, speaking) {
    this.send=send;
    this.report=report;
    this.speaking=speaking;
    this.peers=new Map();
    this.volumes=new Map();
    this.mutes=new Set();
    this.deaf=false;
    this.muted=true;
    this.epoch=0;
  }

  async unlock() {
    const Context=window.AudioContext||window.webkitAudioContext;
    if(Context&&!this.context)this.context=new Context();
    await this.context?.resume().catch(()=>{});
    for(const peer of this.peers.values())if(peer.audio.srcObject&&!peer.meter){peer.meter=this.analyser(peer.audio.srcObject,true);this.updateVolume(peer.name);}
    const results=await Promise.allSettled([...this.peers.values()].map(peer=>peer.audio.srcObject?peer.audio.play():null));
    this.report(results.some(r=>r.status==='rejected')?'Ses için tekrar dokun.':'');
    if(!this.timer)this.timer=setInterval(()=>this.meter(),125);
  }

  async microphone() {
    const epoch=this.epoch;
    await this.unlock();
    if(epoch!==this.epoch)return;
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Bu tarayıcı mikrofon erişimi sunmuyor.');
    if(!this.track||this.track.readyState==='ended') {
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
      if(epoch!==this.epoch){for(const track of stream.getTracks())track.stop();return;}
      this.track=stream.getAudioTracks()[0];
      if(!this.track)throw new Error('Mikrofon bulunamadı.');
      this.local=this.analyser(stream);
      this.track.addEventListener('ended',()=>{this.muted=true;this.report('Mikrofon bağlantısı kesildi.');this.onMicrophone?.(false);});
    }
    this.setMuted(false);
  }

  setMuted(muted) {
    this.muted=muted;
    if(this.track)this.track.enabled=!muted;
    for(const peer of this.peers.values())this.attachTrack(peer).catch(()=>{});
    this.onMicrophone?.(!!this.track&&!muted&&this.track.readyState==='live');
  }

  attachTrack(peer) {
    if(!peer.transceiver)return Promise.resolve();
    return peer.transceiver.sender.replaceTrack(this.track?.readyState==='live'?this.track:null);
  }

  analyser(stream,audible=false) {
    if(!this.context)return null;
    const source=this.context.createMediaStreamSource(stream);
    const node=this.context.createAnalyser();
    node.fftSize=256;
    source.connect(node);
    const gain=audible?this.context.createGain():null;
    if(gain){node.connect(gain);gain.connect(this.context.destination);}
    return {node,source,gain,samples:new Uint8Array(node.fftSize)};
  }

  meter() {
    if(document.hidden)return;
    const active=o=>{
      if(!o)return false;
      o.node.getByteTimeDomainData(o.samples);
      let energy=0;
      for(const value of o.samples)energy+=((value-128)/128)**2;
      return Math.sqrt(energy/o.samples.length)>.035;
    };
    if(this.me)this.speaking(this.me,!this.muted&&active(this.local));
    for(const [name,p] of this.peers)this.speaking(name,active(p.meter));
  }

  initialize(me,config) {
    this.me=me;
    this.config=config;
  }

  sync(players) {
    if(!this.me||!this.config||!window.RTCPeerConnection)return;
    for(const [name] of this.peers)if(!players.some(p=>p.username===name&&p.online&&!p.left))this.close(name);
    for(const player of players)if(player.online&&!player.left&&player.username!==this.me&&!this.peers.has(player.username)){
      const peer=this.peer(player.username);
      if(this.me<player.username)this.offer(peer).catch(()=>this.failed());
    }
  }

  peer(name) {
    const pc=new RTCPeerConnection({iceServers:this.config.iceServers});
    const audio=document.createElement('audio');
    audio.autoplay=true;
    audio.setAttribute('playsinline','');
    audio.hidden=true;
    document.body.append(audio);
    const peer={name,pc,audio,candidates:[],queue:Promise.resolve(),localCandidates:[],descriptionSent:false};
    this.peers.set(name,peer);
    this.updateVolume(name);
    pc.onicecandidate=event=>{
      if(!event.candidate)return;
      const candidate=event.candidate.toJSON();
      if(peer.descriptionSent)this.send(name,'candidate',{candidate});
      else if(peer.localCandidates.length<64)peer.localCandidates.push(candidate);
    };
    pc.ontrack=event=>{
      const stream=event.streams[0]||new MediaStream([event.track]);
      audio.srcObject=stream;
      peer.meter?.source.disconnect();
      peer.meter?.gain?.disconnect();
      peer.meter=this.analyser(stream,true);
      this.updateVolume(name);
      audio.play().catch(()=>this.report('Sesi başlatmak için Ses bağlantısını aç düğmesine dokun.'));
    };
    const status=()=>{
      if(pc.connectionState==='failed'||pc.iceConnectionState==='failed')this.failed();
    };
    pc.onconnectionstatechange=status;
    pc.oniceconnectionstatechange=status;
    return peer;
  }

  async description(peer) {
    const d=peer.pc.localDescription;
    await this.send(peer.name,'description',{description:{type:d.type,sdp:d.sdp}});
    peer.descriptionSent=true;
    for(const candidate of peer.localCandidates)this.send(peer.name,'candidate',{candidate});
    peer.localCandidates=[];
  }

  async offer(peer) {
    peer.transceiver=peer.pc.addTransceiver('audio',{direction:'sendrecv'});
    await this.attachTrack(peer);
    await peer.pc.setLocalDescription(await peer.pc.createOffer());
    await this.description(peer);
  }

  receive(data) {
    const peer=this.peers.get(data.from);
    if(!peer)return;
    peer.queue=peer.queue.then(async()=>{
      if(peer.pc.signalingState==='closed')return;
      if(data.kind==='candidate'){
        if(peer.pc.remoteDescription)await peer.pc.addIceCandidate(data.candidate);
        else if(peer.candidates.length<64)peer.candidates.push(data.candidate);
        return;
      }
      const offer=data.description.type==='offer';
      if(offer!==(this.me>data.from))return;
      await peer.pc.setRemoteDescription(data.description);
      for(const candidate of peer.candidates)await peer.pc.addIceCandidate(candidate).catch(()=>{});
      peer.candidates=[];
      if(offer){
        peer.transceiver=peer.pc.getTransceivers()[0];
        if(!peer.transceiver||peer.transceiver.receiver.track.kind!=='audio')return;
        peer.transceiver.direction='sendrecv';
        await this.attachTrack(peer);
        await peer.pc.setLocalDescription(await peer.pc.createAnswer());
        await this.description(peer);
      }
    }).catch(()=>{if(peer.pc.signalingState!=='closed')this.failed();});
  }

  failed() {
    this.report(this.config?.hasTurn?'Bazı oyuncularla ses bağlantısı kurulamadı.':'Bazı oyuncularla ses bağlantısı kurulamadı. Bu ağda TURN gerekebilir.');
  }

  volume(name,value) {
    this.volumes.set(name,value);
    this.updateVolume(name);
  }

  mutePeer(name,value) {
    if(value)this.mutes.add(name);else this.mutes.delete(name);
    this.updateVolume(name);
  }

  updateVolume(name) {
    const peer=this.peers.get(name);
    if(!peer)return;
    const volume=this.volumes.get(name)??1,muted=this.deaf||this.mutes.has(name);
    if(peer.meter?.gain)peer.meter.gain.gain.value=muted?0:volume;
    peer.audio.volume=volume;
    peer.audio.muted=muted||Boolean(peer.meter?.gain);
  }

  setDeaf(value) {
    this.deaf=value;
    for(const name of this.peers.keys())this.updateVolume(name);
  }

  close(name) {
    const p=this.peers.get(name);
    if(!p)return;
    p.pc.close();
    p.meter?.source.disconnect();
    p.meter?.gain?.disconnect();
    p.audio.remove();
    this.peers.delete(name);
    this.speaking(name,false);
  }

  disconnect() {
    for(const name of this.peers.keys())this.close(name);
  }

  stop() {
    this.epoch++;
    this.disconnect();
    clearInterval(this.timer);
    this.timer=null;
    this.local?.source.disconnect();
    this.local=null;
    this.track?.stop();
    this.track=null;
    if(this.me)this.speaking(this.me,false);
    this.muted=true;
    this.me=null;
    this.config=null;
    this.context?.close().catch(()=>{});
    this.context=null;
  }
};
