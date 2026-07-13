export interface IPreventableShutdownEvent {
  preventDefault(): void
}

/** Await one exact verifier teardown between the first and final will-quit. */
export class ActionsArtifactProvenanceShutdownBarrier {
  private ready = false
  private started = false

  public constructor(
    private readonly shutdown: () => Promise<void>,
    private readonly quit: () => void
  ) {}

  public handle(event: IPreventableShutdownEvent): void {
    if (this.ready) {
      return
    }
    event.preventDefault()
    if (this.started) {
      return
    }
    this.started = true
    void this.shutdown()
      .then(() => {
        this.ready = true
        this.quit()
      })
      .catch(() => {
        // Fail closed. A later will-quit may retry exact teardown.
        this.started = false
      })
  }
}
