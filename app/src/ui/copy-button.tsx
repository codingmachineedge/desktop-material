import { clipboard } from 'electron'
import React from 'react'
import { MaterialSymbol } from './lib/material-symbol'
import { sleep } from '../lib/promise'
import { Button } from './lib/button'
import { AriaLiveContainer } from './accessibility/aria-live-container'

interface ICopyButtonProps {
  readonly copyContent: string
  readonly ariaLabel: string
}

interface ICopyButtonState {
  readonly showCopied: boolean
}

export class CopyButton extends React.Component<
  ICopyButtonProps,
  ICopyButtonState
> {
  public constructor(props: ICopyButtonProps) {
    super(props)

    this.state = {
      showCopied: false,
    }
  }

  private onCopy = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    clipboard.writeText(this.props.copyContent)

    this.setState({ showCopied: true })

    await sleep(2000)

    this.setState({ showCopied: false })
  }

  public renderSymbol() {
    const { showCopied } = this.state

    const name = showCopied ? 'check' : 'content_copy'

    return <MaterialSymbol name={name} size={24} />
  }

  public render() {
    const { ariaLabel } = this.props
    const { showCopied } = this.state

    const copiedMessage = 'Copied!'
    const ariaMessage = showCopied ? copiedMessage : ''
    return (
      <Button
        className="copy-button"
        tooltip={showCopied ? copiedMessage : ariaLabel}
        ariaLabel={ariaLabel}
        onClick={this.onCopy}
        openTooltipOnClick={true}
        applyTooltipAriaDescribedBy={false}
      >
        {this.renderSymbol()}
        <AriaLiveContainer
          message={ariaMessage}
          trackedUserInput={ariaMessage}
        />
      </Button>
    )
  }
}
