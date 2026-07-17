import * as React from 'react'
import { readFile, stat, writeFile } from 'fs/promises'
import {
  DefaultRepositoryLogoDesign,
  IRepositoryLogoDesign,
  IRepositoryLogoMarkLayer,
  IRepositoryLogoTextLayer,
  MaxRepositoryLogoDocumentLength,
  MaxRepositoryLogoLayers,
  normalizeRepositoryLogoDesign,
  parseRepositoryLogoDesign,
  repositoryLogoFontWeights,
  repositoryLogoMarks,
  RepositoryLogoLayer,
  serializeRepositoryLogoDesign,
} from '../../models/repository-logo'
import { showOpenDialog, showSaveDialog } from '../main-process-proxy'
import { Button } from '../lib/button'
import { Select } from '../lib/select'
import { TextBox } from '../lib/text-box'
import { RepositoryLogo } from './repository-logo'

interface IRepositoryLogoStudioProps {
  readonly value: IRepositoryLogoDesign
  readonly repositoryName: string
  readonly disabled?: boolean
  readonly isInherited?: boolean
  readonly onChange: (design: IRepositoryLogoDesign) => void
  readonly onInherit?: () => void
}

interface IRepositoryLogoStudioState {
  readonly design: IRepositoryLogoDesign
  readonly past: ReadonlyArray<IRepositoryLogoDesign>
  readonly future: ReadonlyArray<IRepositoryLogoDesign>
  readonly selectedLayerId: string | null
  readonly transferMessage: string | null
  readonly transferError: boolean
  readonly transferring: boolean
}

const MaxUndoDepth = 30

function signature(design: IRepositoryLogoDesign): string {
  return JSON.stringify(normalizeRepositoryLogoDesign(design))
}

function layerLabel(layer: RepositoryLogoLayer): string {
  if (layer.type === 'mark') {
    return layer.mark === 'monogram'
      ? 'Monogram mark'
      : `${layer.mark[0].toLocaleUpperCase()}${layer.mark.slice(1)} mark`
  }
  switch (layer.source) {
    case 'repository-name':
      return 'Repository name'
    case 'monogram':
      return 'Monogram text'
    case 'custom':
      return layer.text.length > 0 ? `Text: ${layer.text}` : 'Custom text'
  }
}

function fileSafeName(value: string): string {
  const safe = value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '')
  return `${safe || 'repository'}-logo.json`
}

/** Full vector logo editor shared by profile defaults and repository overrides. */
export class RepositoryLogoStudio extends React.Component<
  IRepositoryLogoStudioProps,
  IRepositoryLogoStudioState
> {
  private currentDesign: IRepositoryLogoDesign
  private transferRequestId = 0
  private mounted = false

  public constructor(props: IRepositoryLogoStudioProps) {
    super(props)
    const design = normalizeRepositoryLogoDesign(props.value)
    this.currentDesign = design
    this.state = {
      design,
      past: [],
      future: [],
      selectedLayerId: design.layers[0]?.id ?? null,
      transferMessage: null,
      transferError: false,
      transferring: false,
    }
  }

  public componentDidMount() {
    this.mounted = true
  }

  public componentDidUpdate(prevProps: IRepositoryLogoStudioProps) {
    const repositoryChanged =
      prevProps.repositoryName !== this.props.repositoryName
    const valuePropChanged = prevProps.value !== this.props.value
    const externalDesignChanged =
      valuePropChanged &&
      signature(this.props.value) !== signature(this.currentDesign)

    if (!repositoryChanged && !valuePropChanged) {
      return
    }

    // File dialogs and reads can outlive the settings surface or be followed
    // by a repository/profile switch. Invalidate that work before accepting
    // the new context so it cannot commit a logo for the previous one.
    this.transferRequestId++
    if (externalDesignChanged) {
      const design = normalizeRepositoryLogoDesign(this.props.value)
      this.currentDesign = design
      this.setState({
        design,
        past: [],
        future: [],
        selectedLayerId: design.layers[0]?.id ?? null,
        transferMessage: null,
        transferError: false,
        transferring: false,
      })
    } else {
      this.setState({
        transferMessage: null,
        transferError: false,
        transferring: false,
      })
    }
  }

  public componentWillUnmount() {
    this.mounted = false
    this.transferRequestId++
  }

  private get editingDisabled(): boolean {
    return this.props.disabled === true || this.state.transferring
  }

  private beginTransfer(): number {
    const requestId = ++this.transferRequestId
    this.setState({
      transferring: true,
      transferMessage: null,
      transferError: false,
    })
    return requestId
  }

  private isCurrentTransfer(requestId: number): boolean {
    return this.mounted && requestId === this.transferRequestId
  }

  private commit = (
    candidate: IRepositoryLogoDesign,
    selectedLayerId = this.state.selectedLayerId
  ) => {
    const design = normalizeRepositoryLogoDesign(candidate)
    if (signature(design) === signature(this.currentDesign)) {
      return
    }
    const previous = this.currentDesign
    this.currentDesign = design
    const selected = design.layers.some(layer => layer.id === selectedLayerId)
      ? selectedLayerId
      : design.layers[0]?.id ?? null
    this.setState(state => ({
      design,
      past: [...state.past, previous].slice(-MaxUndoDepth),
      future: [],
      selectedLayerId: selected,
      transferMessage: null,
      transferError: false,
    }))
    this.props.onChange(design)
  }

  private restoreHistory(
    design: IRepositoryLogoDesign,
    past: ReadonlyArray<IRepositoryLogoDesign>,
    future: ReadonlyArray<IRepositoryLogoDesign>
  ) {
    this.currentDesign = design
    const selectedLayerId = design.layers.some(
      layer => layer.id === this.state.selectedLayerId
    )
      ? this.state.selectedLayerId
      : design.layers[0]?.id ?? null
    this.setState({
      design,
      past,
      future,
      selectedLayerId,
      transferMessage: null,
      transferError: false,
    })
    this.props.onChange(design)
  }

  private onUndo = () => {
    const design = this.state.past.at(-1)
    if (design === undefined) {
      return
    }
    this.restoreHistory(design, this.state.past.slice(0, -1), [
      this.currentDesign,
      ...this.state.future,
    ])
  }

  private onRedo = () => {
    const design = this.state.future[0]
    if (design === undefined) {
      return
    }
    this.restoreHistory(
      design,
      [...this.state.past, this.currentDesign].slice(-MaxUndoDepth),
      this.state.future.slice(1)
    )
  }

  private onReset = () => {
    this.commit(DefaultRepositoryLogoDesign)
  }

  private onInherit = () => {
    this.props.onInherit?.()
  }

  private patchBackground(patch: Readonly<Record<string, unknown>>) {
    this.commit({
      ...this.currentDesign,
      background: { ...this.currentDesign.background, ...patch },
    })
  }

  private onBackgroundSelectChanged = (
    event: React.FormEvent<HTMLSelectElement>
  ) => {
    this.patchBackground({
      [event.currentTarget.name]: event.currentTarget.value,
    })
  }

  private onBackgroundColorChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.patchBackground({
      [event.currentTarget.name]: event.currentTarget.value,
    })
  }

  private onBackgroundRangeChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.patchBackground({
      [event.currentTarget.name]: parseFloat(event.currentTarget.value),
    })
  }

  private selectedLayer(): RepositoryLogoLayer | null {
    return (
      this.currentDesign.layers.find(
        layer => layer.id === this.state.selectedLayerId
      ) ?? null
    )
  }

  private patchSelectedLayer(patch: Readonly<Record<string, unknown>>) {
    const selectedLayerId = this.state.selectedLayerId
    if (selectedLayerId === null) {
      return
    }
    this.commit({
      ...this.currentDesign,
      layers: this.currentDesign.layers.map(layer =>
        layer.id === selectedLayerId ? { ...layer, ...patch } : layer
      ),
    })
  }

  private onLayerSelected = (event: React.MouseEvent<HTMLButtonElement>) => {
    this.setState({ selectedLayerId: event.currentTarget.value })
  }

  private onLayerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const layers = this.state.design.layers
    const currentIndex = layers.findIndex(
      layer => layer.id === event.currentTarget.value
    )
    if (currentIndex < 0 || layers.length === 0) {
      return
    }

    let targetIndex: number
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowUp':
        targetIndex = (currentIndex - 1 + layers.length) % layers.length
        break
      case 'ArrowRight':
      case 'ArrowDown':
        targetIndex = (currentIndex + 1) % layers.length
        break
      case 'Home':
        targetIndex = 0
        break
      case 'End':
        targetIndex = layers.length - 1
        break
      default:
        return
    }

    event.preventDefault()
    const targetId = layers[targetIndex].id
    const tabList = event.currentTarget.parentElement
    this.setState({ selectedLayerId: targetId }, () => {
      const tabs = tabList?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      Array.from(tabs ?? [])
        .find(tab => tab.value === targetId)
        ?.focus()
    })
  }

  private onLayerSelectChanged = (
    event: React.FormEvent<HTMLSelectElement>
  ) => {
    const value =
      event.currentTarget.name === 'fontWeight'
        ? parseInt(event.currentTarget.value, 10)
        : event.currentTarget.value
    this.patchSelectedLayer({
      [event.currentTarget.name]: value,
    })
  }

  private onLayerColorChanged = (event: React.FormEvent<HTMLInputElement>) => {
    this.patchSelectedLayer({
      [event.currentTarget.name]: event.currentTarget.value,
    })
  }

  private onLayerRangeChanged = (event: React.FormEvent<HTMLInputElement>) => {
    this.patchSelectedLayer({
      [event.currentTarget.name]: parseFloat(event.currentTarget.value),
    })
  }

  private onTextChanged = (text: string) => {
    this.patchSelectedLayer({ text })
  }

  private nextLayerId(prefix: string): string {
    const ids = new Set(this.currentDesign.layers.map(layer => layer.id))
    let sequence = this.currentDesign.layers.length + 1
    while (ids.has(`${prefix}-${sequence}`)) {
      sequence++
    }
    return `${prefix}-${sequence}`
  }

  private onAddMark = () => {
    if (this.currentDesign.layers.length >= MaxRepositoryLogoLayers) {
      return
    }
    const layer: IRepositoryLogoMarkLayer = {
      id: this.nextLayerId('mark'),
      type: 'mark',
      mark: 'sparkle',
      x: 50,
      y: 50,
      scale: 1,
      rotation: 0,
      opacity: 1,
      color: '#ffffff',
    }
    this.commit(
      { ...this.currentDesign, layers: [...this.currentDesign.layers, layer] },
      layer.id
    )
  }

  private onAddText = () => {
    if (this.currentDesign.layers.length >= MaxRepositoryLogoLayers) {
      return
    }
    const layer: IRepositoryLogoTextLayer = {
      id: this.nextLayerId('text'),
      type: 'text',
      source: 'custom',
      text: 'DM',
      font: 'sans',
      fontWeight: 700,
      letterSpacing: 0,
      x: 50,
      y: 70,
      scale: 1,
      rotation: 0,
      opacity: 1,
      color: '#ffffff',
    }
    this.commit(
      { ...this.currentDesign, layers: [...this.currentDesign.layers, layer] },
      layer.id
    )
  }

  private onDeleteLayer = () => {
    const selectedLayerId = this.state.selectedLayerId
    if (selectedLayerId === null) {
      return
    }
    const layers = this.currentDesign.layers.filter(
      layer => layer.id !== selectedLayerId
    )
    this.commit({ ...this.currentDesign, layers }, layers[0]?.id ?? null)
  }

  private moveSelected(direction: -1 | 1) {
    const selectedLayerId = this.state.selectedLayerId
    const index = this.currentDesign.layers.findIndex(
      layer => layer.id === selectedLayerId
    )
    const target = index + direction
    if (index < 0 || target < 0 || target >= this.currentDesign.layers.length) {
      return
    }
    const layers = [...this.currentDesign.layers]
    const [layer] = layers.splice(index, 1)
    layers.splice(target, 0, layer)
    this.commit({ ...this.currentDesign, layers })
  }

  private onMoveLayerBack = () => this.moveSelected(-1)
  private onMoveLayerForward = () => this.moveSelected(1)

  private onRepositoryPreset = () => {
    this.commit({
      ...this.currentDesign,
      layers: [
        {
          id: 'repository-mark',
          type: 'mark',
          mark: 'repository',
          x: 50,
          y: 50,
          scale: 1.35,
          rotation: 0,
          opacity: 1,
          color: '#ffffff',
        },
      ],
    })
  }

  private onMonogramPreset = () => {
    this.commit({
      ...this.currentDesign,
      layers: [
        {
          id: 'monogram-mark',
          type: 'mark',
          mark: 'monogram',
          x: 50,
          y: 50,
          scale: 1.2,
          rotation: 0,
          opacity: 1,
          color: '#ffffff',
        },
      ],
    })
  }

  private onRepositoryNamePreset = () => {
    this.commit({
      ...this.currentDesign,
      layers: [
        {
          id: 'repository-name',
          type: 'text',
          source: 'repository-name',
          text: '',
          font: 'sans',
          fontWeight: 700,
          letterSpacing: 0,
          x: 50,
          y: 50,
          scale: 0.85,
          rotation: 0,
          opacity: 1,
          color: '#ffffff',
        },
      ],
    })
  }

  private onImport = async () => {
    const requestId = this.beginTransfer()
    let path: string | null
    try {
      path = await showOpenDialog({
        properties: ['openFile'],
        filters: [
          { name: 'Desktop Material repository logo', extensions: ['json'] },
        ],
      })
    } catch (error) {
      this.setTransferError(error, requestId)
      return
    }
    if (!this.isCurrentTransfer(requestId)) {
      return
    }
    if (path === null) {
      this.setState({ transferring: false })
      return
    }
    try {
      const file = await stat(path)
      if (!this.isCurrentTransfer(requestId)) {
        return
      }
      if (file.size > MaxRepositoryLogoDocumentLength) {
        throw new Error(
          `Logo documents must be ${MaxRepositoryLogoDocumentLength.toLocaleString()} bytes or smaller.`
        )
      }
      const serialized = await readFile(path, 'utf8')
      if (!this.isCurrentTransfer(requestId)) {
        return
      }
      const design = parseRepositoryLogoDesign(serialized)
      if (design === null) {
        throw new Error('That file is not a valid version 1 repository logo.')
      }
      this.commit(design, design.layers[0]?.id ?? null)
      if (!this.isCurrentTransfer(requestId)) {
        return
      }
      this.setState({
        transferring: false,
        transferMessage:
          'Logo imported. Save this settings window to apply it.',
        transferError: false,
      })
    } catch (error) {
      this.setTransferError(error, requestId)
    }
  }

  private onExport = async () => {
    const design = this.currentDesign
    const requestId = this.beginTransfer()
    let path: string | null
    try {
      path = await showSaveDialog({
        buttonLabel: 'Export logo',
        defaultPath: fileSafeName(this.props.repositoryName),
        filters: [
          { name: 'Desktop Material repository logo', extensions: ['json'] },
        ],
      })
    } catch (error) {
      this.setTransferError(error, requestId)
      return
    }
    if (!this.isCurrentTransfer(requestId)) {
      return
    }
    if (path === null) {
      this.setState({ transferring: false })
      return
    }
    try {
      await writeFile(path, serializeRepositoryLogoDesign(design), 'utf8')
      if (!this.isCurrentTransfer(requestId)) {
        return
      }
      this.setState({
        transferring: false,
        transferMessage: 'Logo JSON exported.',
        transferError: false,
      })
    } catch (error) {
      this.setTransferError(error, requestId)
    }
  }

  private setTransferError(error: unknown, requestId: number) {
    if (!this.isCurrentTransfer(requestId)) {
      return
    }
    this.setState({
      transferring: false,
      transferMessage: error instanceof Error ? error.message : `${error}`,
      transferError: true,
    })
  }

  private renderRange(
    name: string,
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    suffix: string,
    onChange: (event: React.FormEvent<HTMLInputElement>) => void
  ) {
    return (
      <label className="repository-logo-range">
        <span>{label}</span>
        <output>{`${value}${suffix}`}</output>
        <input
          type="range"
          name={name}
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={this.editingDisabled}
          aria-label={label}
          onChange={onChange}
        />
      </label>
    )
  }

  private renderBackgroundEditor() {
    const background = this.state.design.background
    return (
      <fieldset className="repository-logo-panel">
        <legend>Background</legend>
        <div className="repository-logo-control-grid">
          <Select
            name="shape"
            label="Shape"
            value={background.shape}
            disabled={this.editingDisabled}
            onChange={this.onBackgroundSelectChanged}
          >
            <option value="rounded">Rounded square</option>
            <option value="circle">Circle</option>
            <option value="square">Square</option>
            <option value="hexagon">Hexagon</option>
          </Select>
          <Select
            name="fill"
            label="Fill"
            value={background.fill}
            disabled={this.editingDisabled}
            onChange={this.onBackgroundSelectChanged}
          >
            <option value="solid">Solid</option>
            <option value="gradient">Gradient</option>
          </Select>
          <Select
            name="shadow"
            label="Shadow"
            value={background.shadow}
            disabled={this.editingDisabled}
            onChange={this.onBackgroundSelectChanged}
          >
            <option value="none">None</option>
            <option value="soft">Soft</option>
            <option value="strong">Strong</option>
          </Select>
          <label className="repository-logo-color">
            <span>
              {background.fill === 'gradient' ? 'Start color' : 'Color'}
            </span>
            <input
              type="color"
              name="primaryColor"
              value={background.primaryColor}
              disabled={this.editingDisabled}
              onChange={this.onBackgroundColorChanged}
            />
          </label>
          {background.fill === 'gradient' && (
            <label className="repository-logo-color">
              <span>End color</span>
              <input
                type="color"
                name="secondaryColor"
                value={background.secondaryColor}
                disabled={this.editingDisabled}
                onChange={this.onBackgroundColorChanged}
              />
            </label>
          )}
          <label className="repository-logo-color">
            <span>Border color</span>
            <input
              type="color"
              name="borderColor"
              value={background.borderColor}
              disabled={this.editingDisabled}
              onChange={this.onBackgroundColorChanged}
            />
          </label>
        </div>
        <div className="repository-logo-range-grid">
          {background.fill === 'gradient' &&
            this.renderRange(
              'gradientAngle',
              'Gradient angle',
              background.gradientAngle,
              0,
              360,
              1,
              '°',
              this.onBackgroundRangeChanged
            )}
          {this.renderRange(
            'borderWidth',
            'Border width',
            background.borderWidth,
            0,
            6,
            1,
            'px',
            this.onBackgroundRangeChanged
          )}
        </div>
      </fieldset>
    )
  }

  private renderLayerSpecific(layer: RepositoryLogoLayer) {
    if (layer.type === 'mark') {
      return (
        <Select
          name="mark"
          label="Mark"
          value={layer.mark}
          disabled={this.editingDisabled}
          onChange={this.onLayerSelectChanged}
        >
          {repositoryLogoMarks.map(mark => (
            <option key={mark} value={mark}>
              {mark === 'monogram'
                ? 'Repository monogram'
                : `${mark[0].toLocaleUpperCase()}${mark.slice(1)}`}
            </option>
          ))}
        </Select>
      )
    }
    return (
      <>
        <Select
          name="source"
          label="Text source"
          value={layer.source}
          disabled={this.editingDisabled}
          onChange={this.onLayerSelectChanged}
        >
          <option value="repository-name">Repository name</option>
          <option value="monogram">Repository monogram</option>
          <option value="custom">Custom text</option>
        </Select>
        <TextBox
          label="Custom text"
          value={layer.text}
          disabled={this.editingDisabled || layer.source !== 'custom'}
          onValueChanged={this.onTextChanged}
        />
        <Select
          name="font"
          label="Font"
          value={layer.font}
          disabled={this.editingDisabled}
          onChange={this.onLayerSelectChanged}
        >
          <option value="sans">Sans serif</option>
          <option value="serif">Serif</option>
          <option value="monospace">Monospace</option>
        </Select>
        <Select
          name="fontWeight"
          label="Weight"
          value={layer.fontWeight.toString()}
          disabled={this.editingDisabled}
          onChange={this.onLayerSelectChanged}
        >
          {repositoryLogoFontWeights.map(weight => (
            <option key={weight} value={weight.toString()}>
              {weight}
            </option>
          ))}
        </Select>
        {this.renderRange(
          'letterSpacing',
          'Letter spacing',
          layer.letterSpacing,
          -1,
          4,
          0.25,
          'px',
          this.onLayerRangeChanged
        )}
      </>
    )
  }

  private renderSelectedLayerEditor() {
    const layer = this.selectedLayer()
    if (layer === null) {
      return (
        <div className="repository-logo-empty-layer">
          Add a mark or text layer to start composing.
        </div>
      )
    }
    const index = this.state.design.layers.findIndex(
      candidate => candidate.id === layer.id
    )
    return (
      <div className="repository-logo-layer-editor">
        <div className="repository-logo-layer-heading">
          <strong>{layerLabel(layer)}</strong>
          <div>
            <Button
              type="button"
              size="small"
              disabled={this.editingDisabled || index === 0}
              onClick={this.onMoveLayerBack}
            >
              Move back
            </Button>
            <Button
              type="button"
              size="small"
              disabled={
                this.editingDisabled ||
                index === this.state.design.layers.length - 1
              }
              onClick={this.onMoveLayerForward}
            >
              Move forward
            </Button>
            <Button
              type="button"
              size="small"
              disabled={this.editingDisabled}
              onClick={this.onDeleteLayer}
            >
              Delete
            </Button>
          </div>
        </div>
        <div className="repository-logo-control-grid">
          {this.renderLayerSpecific(layer)}
          <label className="repository-logo-color">
            <span>Layer color</span>
            <input
              type="color"
              name="color"
              value={layer.color}
              disabled={this.editingDisabled}
              onChange={this.onLayerColorChanged}
            />
          </label>
        </div>
        <div className="repository-logo-range-grid">
          {this.renderRange(
            'x',
            'Horizontal position',
            layer.x,
            0,
            100,
            0.5,
            '%',
            this.onLayerRangeChanged
          )}
          {this.renderRange(
            'y',
            'Vertical position',
            layer.y,
            0,
            100,
            0.5,
            '%',
            this.onLayerRangeChanged
          )}
          {this.renderRange(
            'scale',
            'Scale',
            layer.scale,
            0.25,
            3,
            0.05,
            '×',
            this.onLayerRangeChanged
          )}
          {this.renderRange(
            'rotation',
            'Rotation',
            layer.rotation,
            -180,
            180,
            1,
            '°',
            this.onLayerRangeChanged
          )}
          {this.renderRange(
            'opacity',
            'Opacity',
            layer.opacity,
            0.1,
            1,
            0.05,
            '',
            this.onLayerRangeChanged
          )}
        </div>
      </div>
    )
  }

  public render() {
    const layerCapReached =
      this.state.design.layers.length >= MaxRepositoryLogoLayers
    return (
      <section
        className="repository-logo-studio"
        aria-labelledby="repository-logo-studio-heading"
        aria-busy={this.state.transferring}
      >
        <header className="repository-logo-studio-heading">
          <div>
            <h3 id="repository-logo-studio-heading">Custom repository logo</h3>
            <p>
              Compose a safe vector logo from editable marks and text. No image
              data or executable SVG is stored.
            </p>
          </div>
          <div className="repository-logo-history-actions">
            {this.props.isInherited === true && (
              <span className="repository-logo-inherited">Profile default</span>
            )}
            <Button
              type="button"
              size="small"
              disabled={this.editingDisabled || this.state.past.length === 0}
              onClick={this.onUndo}
            >
              Undo
            </Button>
            <Button
              type="button"
              size="small"
              disabled={this.editingDisabled || this.state.future.length === 0}
              onClick={this.onRedo}
            >
              Redo
            </Button>
            {this.props.onInherit === undefined ? (
              <Button
                type="button"
                size="small"
                disabled={this.editingDisabled}
                onClick={this.onReset}
              >
                Reset default
              </Button>
            ) : (
              <Button
                type="button"
                size="small"
                disabled={this.editingDisabled || this.props.isInherited}
                onClick={this.onInherit}
              >
                Inherit profile logo
              </Button>
            )}
          </div>
        </header>

        <div className="repository-logo-workbench">
          <div
            className="repository-logo-preview"
            role="img"
            aria-label={`Live logo preview for ${this.props.repositoryName}`}
          >
            <span>Live preview</span>
            <RepositoryLogo
              design={this.state.design}
              repositoryName={this.props.repositoryName}
              size={172}
            />
            <strong>{this.props.repositoryName}</strong>
          </div>
          <div className="repository-logo-editor-scroll">
            <div
              className="repository-logo-presets"
              role="group"
              aria-label="Logo presets"
            >
              <span>Start from</span>
              <Button
                type="button"
                size="small"
                disabled={this.editingDisabled}
                onClick={this.onRepositoryPreset}
              >
                Repository mark
              </Button>
              <Button
                type="button"
                size="small"
                disabled={this.editingDisabled}
                onClick={this.onMonogramPreset}
              >
                Monogram
              </Button>
              <Button
                type="button"
                size="small"
                disabled={this.editingDisabled}
                onClick={this.onRepositoryNamePreset}
              >
                Repository name
              </Button>
            </div>
            {this.renderBackgroundEditor()}
            <fieldset className="repository-logo-panel repository-logo-layers-panel">
              <legend>Layers</legend>
              <div className="repository-logo-layer-toolbar">
                <span>
                  {this.state.design.layers.length} of {MaxRepositoryLogoLayers}
                </span>
                <Button
                  type="button"
                  size="small"
                  disabled={this.editingDisabled || layerCapReached}
                  onClick={this.onAddMark}
                >
                  Add mark
                </Button>
                <Button
                  type="button"
                  size="small"
                  disabled={this.editingDisabled || layerCapReached}
                  onClick={this.onAddText}
                >
                  Add text
                </Button>
              </div>
              <div
                className="repository-logo-layer-tabs"
                role="tablist"
                aria-label="Logo layers"
              >
                {this.state.design.layers.map(layer => (
                  <button
                    key={layer.id}
                    type="button"
                    role="tab"
                    value={layer.id}
                    aria-selected={layer.id === this.state.selectedLayerId}
                    tabIndex={layer.id === this.state.selectedLayerId ? 0 : -1}
                    disabled={this.editingDisabled}
                    onClick={this.onLayerSelected}
                    onKeyDown={this.onLayerKeyDown}
                  >
                    {layerLabel(layer)}
                  </button>
                ))}
              </div>
              {this.renderSelectedLayerEditor()}
            </fieldset>
          </div>
        </div>

        <footer className="repository-logo-transfer">
          <div>
            <Button
              type="button"
              size="small"
              disabled={this.editingDisabled}
              onClick={this.onImport}
            >
              Import JSON…
            </Button>
            <Button
              type="button"
              size="small"
              disabled={this.editingDisabled}
              onClick={this.onExport}
            >
              Export JSON…
            </Button>
          </div>
          {this.state.transferMessage !== null && (
            <p
              className={this.state.transferError ? 'validation-error' : ''}
              role={this.state.transferError ? 'alert' : 'status'}
            >
              {this.state.transferMessage}
            </p>
          )}
        </footer>
      </section>
    )
  }
}
