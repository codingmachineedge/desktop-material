import * as React from 'react'

import { Row } from '../lib/row'
import {
  Dialog,
  DialogContent,
  OkCancelButtonGroup,
  DialogFooter,
} from '../dialog'
import { updateStore, IUpdateState, UpdateStatus } from '../lib/update-store'
import { Disposable } from 'event-kit'
import { Dispatcher } from '../dispatcher'
import { DefaultAppDisplayName } from '../../models/app-identity'

interface IInstallingUpdateProps {
  /**
   * Event triggered when the dialog is dismissed by the user in the
   * ways described in the Dialog component's dismissable prop.
   */
  readonly onDismissed: () => void

  readonly dispatcher: Dispatcher
}

/**
 * A dialog that presents information about the
 * running application such as name and version.
 */
export class InstallingUpdate extends React.Component<IInstallingUpdateProps> {
  private updateStoreEventHandle: Disposable | null = null
  /** An accepted quit must not be cancelled when the dialog unmounts. */
  private quitRequested = false

  private requestQuit = async (evenIfUpdating: boolean): Promise<void> => {
    this.quitRequested = true
    try {
      await this.props.dispatcher.quitApp(evenIfUpdating)
    } catch (error) {
      // If the terminal action could not be prepared, a later dismissal is a
      // genuine cancellation again rather than an accepted quit.
      this.quitRequested = false
      throw error
    }
  }

  private onUpdateStateChanged = (updateState: IUpdateState) => {
    // If the update is not being downloaded (`UpdateStatus.UpdateAvailable`),
    // i.e. if it's already downloaded or not available, close the window.
    if (updateState.status !== UpdateStatus.UpdateAvailable) {
      void this.requestQuit(false).catch(error =>
        log.error('Unable to quit after the update state changed', error)
      )
    }
  }

  public componentDidMount() {
    this.updateStoreEventHandle = updateStore.onDidChange(
      this.onUpdateStateChanged
    )

    // Manually update the state to ensure we're in sync with the store
    this.onUpdateStateChanged(updateStore.state)
  }

  public componentWillUnmount() {
    if (this.updateStoreEventHandle) {
      this.updateStoreEventHandle.dispose()
      this.updateStoreEventHandle = null
    }

    // A dismissed/cancelled dialog stops a pending quit, but an affirmative
    // Quit anyway may unmount this component while the bounded renderer drain
    // is still running. Do not reset that accepted terminal action.
    if (!this.quitRequested) {
      this.props.dispatcher.cancelQuittingApp()
    }
  }

  private onQuitAnywayButtonClicked = () => {
    void this.requestQuit(true).catch(error =>
      log.error('Unable to quit while an update is in progress', error)
    )
  }

  public render() {
    return (
      <Dialog
        id="installing-update"
        title={__DARWIN__ ? 'Installing Update…' : 'Installing update…'}
        loading={true}
        onSubmit={this.props.onDismissed}
        backdropDismissable={false}
        type="warning"
        onDismissed={this.props.onDismissed}
      >
        <DialogContent>
          <Row className="updating-message">
            Do not close {DefaultAppDisplayName} while the update is in
            progress. Closing now may break your installation.
          </Row>
        </DialogContent>
        <DialogFooter>
          <OkCancelButtonGroup
            okButtonText={__DARWIN__ ? 'Quit Anyway' : 'Quit anyway'}
            onOkButtonClick={this.onQuitAnywayButtonClicked}
            onCancelButtonClick={this.props.onDismissed}
            destructive={true}
          />
        </DialogFooter>
      </Dialog>
    )
  }
}
