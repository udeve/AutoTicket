export interface Notifier {
  notify(message: string): Promise<boolean>;
}

export class NullNotifier implements Notifier {
  async notify(): Promise<boolean> {
    return true;
  }
}

export class CompositeNotifier implements Notifier {
  constructor(private readonly notifiers: Notifier[]) {}

  async notify(message: string): Promise<boolean> {
    const results = await Promise.all(this.notifiers.map((notifier) => notifier.notify(message)));
    return results.every(Boolean);
  }
}
