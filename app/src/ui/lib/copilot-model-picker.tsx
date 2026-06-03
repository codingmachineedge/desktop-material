import * as React from 'react'
import type { ModelInfo } from '@github/copilot-sdk'
import memoizeOne from 'memoize-one'

import { DefaultCopilotModel } from '../../lib/stores/copilot-store'
import { type IBYOKProvider, encodeModelKey } from '../../lib/copilot/byok'
import { IFilterListGroup, IFilterListItem } from './filter-list'
import { PopoverDropdown } from './popover-dropdown'
import { SectionFilterList } from './section-filter-list'

interface ICopilotModelPickerProps {
  readonly label: string
  readonly copilotModels: ReadonlyArray<ModelInfo>
  readonly byokProviders: ReadonlyArray<IBYOKProvider>
  readonly value: string
  readonly onChange: (value: string) => void
}

interface ICopilotModelPickerState {
  readonly filterText: string
  readonly selectedItemId: string | undefined
}

interface ICopilotModelListItem extends IFilterListItem {
  readonly id: string
  readonly text: ReadonlyArray<string>
  readonly value: string
  readonly name: string
  readonly isDefault: boolean
}

const getCopilotModelLabel = (item: ICopilotModelListItem) =>
  item.isDefault ? `${item.name} (default)` : item.name

const getCopilotModelGroups = (
  copilotModels: ReadonlyArray<ModelInfo>,
  byokProviders: ReadonlyArray<IBYOKProvider>
): ReadonlyArray<IFilterListGroup<ICopilotModelListItem>> => {
  const groups = new Array<IFilterListGroup<ICopilotModelListItem>>()

  if (copilotModels.length > 0) {
    const providerName = 'GitHub Copilot'

    groups.push({
      identifier: providerName,
      items: copilotModels.map(model => {
        const value = encodeModelKey({
          kind: 'copilot',
          modelId: model.id,
        })

        return {
          id: value,
          text: [model.name, model.id, providerName],
          value,
          name: model.name,
          isDefault: model.id === DefaultCopilotModel,
        }
      }),
    })
  }

  for (const provider of byokProviders) {
    if (provider.models.length === 0) {
      continue
    }

    groups.push({
      identifier: provider.name,
      items: provider.models.map(model => {
        const value = encodeModelKey({
          kind: 'byok',
          providerId: provider.id,
          modelId: model.id,
        })

        return {
          id: value,
          text: [model.name, model.id, provider.name],
          value,
          name: model.name,
          isDefault: false,
        }
      }),
    })
  }

  return groups
}

export const hasCopilotModelPickerItems = (
  copilotModels: ReadonlyArray<ModelInfo>,
  byokProviders: ReadonlyArray<IBYOKProvider>
) =>
  copilotModels.length > 0 ||
  byokProviders.some(provider => provider.models.length > 0)

export class CopilotModelPicker extends React.Component<
  ICopilotModelPickerProps,
  ICopilotModelPickerState
> {
  private readonly popoverRef = React.createRef<PopoverDropdown>()
  private readonly getGroups = memoizeOne(getCopilotModelGroups)
  private readonly getSelectedItem = memoizeOne(
    (
      groups: ReadonlyArray<IFilterListGroup<ICopilotModelListItem>>,
      selectedItemId: string | undefined,
      value: string
    ) => {
      const items = groups.flatMap(group => group.items)
      const selectedItem =
        selectedItemId === undefined
          ? undefined
          : items.find(item => item.id === selectedItemId)

      return selectedItem ?? items.find(item => item.value === value) ?? null
    }
  )
  private readonly getItemByValue = memoizeOne(
    (
      groups: ReadonlyArray<IFilterListGroup<ICopilotModelListItem>>,
      value: string
    ) => groups.flatMap(group => group.items).find(item => item.value === value)
  )

  public constructor(props: ICopilotModelPickerProps) {
    super(props)

    this.state = {
      filterText: '',
      selectedItemId: undefined,
    }
  }

  public componentDidUpdate(prevProps: ICopilotModelPickerProps) {
    if (
      prevProps.value !== this.props.value ||
      prevProps.copilotModels !== this.props.copilotModels ||
      prevProps.byokProviders !== this.props.byokProviders
    ) {
      this.setState({ selectedItemId: undefined })
    }
  }

  private onFilterTextChanged = (filterText: string) => {
    this.setState({ filterText })
  }

  private onItemClick = (item: ICopilotModelListItem) => {
    this.popoverRef.current?.closePopover()
    this.setState({ selectedItemId: item.id })
    this.props.onChange(item.value)
  }

  private onSelectionChanged = (selectedItem: ICopilotModelListItem | null) => {
    this.setState({ selectedItemId: selectedItem?.id })
  }

  private renderModel = (item: ICopilotModelListItem) => {
    return (
      <div className="copilot-model-list-item">
        <div className="info">
          <div className="title">{getCopilotModelLabel(item)}</div>
        </div>
      </div>
    )
  }

  private renderGroupHeader = (identifier: string) => {
    return (
      <div className="copilot-model-list-group filter-list-group-header">
        {identifier}
      </div>
    )
  }

  private renderNoItems = () => {
    return <div className="copilot-model-list-empty">No models found.</div>
  }

  private getItemAriaLabel = (item: ICopilotModelListItem) =>
    getCopilotModelLabel(item)

  private getGroupAriaLabel = (group: number) => {
    const groups = this.getGroups(
      this.props.copilotModels,
      this.props.byokProviders
    )
    const modelGroup = groups[group]

    return modelGroup === undefined ? undefined : modelGroup.identifier
  }

  public render() {
    const groups = this.getGroups(
      this.props.copilotModels,
      this.props.byokProviders
    )
    const selectedItem = this.getSelectedItem(
      groups,
      this.state.selectedItemId,
      this.props.value
    )
    const buttonItem = this.getItemByValue(groups, this.props.value)

    return (
      <PopoverDropdown
        className="copilot-model-picker"
        contentTitle="Choose a model"
        buttonContent={
          <div className="copilot-model-picker-button-content">
            <span className="name">
              {buttonItem ? getCopilotModelLabel(buttonItem) : ''}
            </span>
          </div>
        }
        label={this.props.label}
        ref={this.popoverRef}
      >
        <SectionFilterList<ICopilotModelListItem>
          className="copilot-model-list"
          rowHeight={36}
          groups={groups}
          selectedItem={selectedItem}
          renderItem={this.renderModel}
          renderGroupHeader={this.renderGroupHeader}
          filterText={this.state.filterText}
          onFilterTextChanged={this.onFilterTextChanged}
          invalidationProps={groups}
          onItemClick={this.onItemClick}
          onSelectionChanged={this.onSelectionChanged}
          getItemAriaLabel={this.getItemAriaLabel}
          getGroupAriaLabel={this.getGroupAriaLabel}
          placeholderText="Filter models"
          renderNoItems={this.renderNoItems}
        />
      </PopoverDropdown>
    )
  }
}
