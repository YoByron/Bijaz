export interface IncomingMessage {
  channel: 'telegram' | 'whatsapp' | 'cli';
  senderId: string;
  text: string;
}

export interface ChannelAdapter {
  name: string;
  sendMessage(target: string, text: string): Promise<void>;
}
