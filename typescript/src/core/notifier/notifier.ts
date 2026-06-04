export interface Notifier {
  notify(message: string): Promise<boolean>;
}

export class NullNotifier implements Notifier {
  async notify(): Promise<boolean> {
    return true;
  }
}
