// A lot of functionality derived and adapted from:
// https://github.com/contentful/extensions/blob/master/samples/publish-confirm/src/index.js

import * as React from 'react';
import { render } from 'react-dom';
import { Button, Paragraph, TextLink } from '@contentful/forma-36-react-components';
import {
  init,
  locations,
  SidebarExtensionSDK,
  ContentType,
} from 'contentful-ui-extensions-sdk';
import { Entry } from 'contentful-management/dist/typings/entities/entry';
import '@contentful/forma-36-react-components/dist/styles.css';
import './index.css';
import relativeDate from 'relative-date'

interface IState {
  working: boolean;
  isDraft: boolean;
  hasPendingChanges: boolean;
  isPublished: boolean;
  displayFieldsMap: {};
}

export class SidebarExtension extends React.Component<
  {
    sdk: SidebarExtensionSDK;
  },
  IState
> {
  detachFns: any[];
  constructor(props) {
    super(props);

    this.state = this.constructState();
  }

  componentDidMount() {
    this.detachFns = [];

    const fields = this.props.sdk.entry.fields;

    for (const key in fields) {
      this.detachFns.push(fields[key].onValueChanged(this.onUpdate));
    }

    this.props.sdk.space.getContentTypes<ContentType>().then((allContentTypes) => {
      const displayFieldsMap = {};
      for (const ct of allContentTypes.items) {
        displayFieldsMap[ct.sys.id] = ct.displayField;
      }

      this.setState({
        displayFieldsMap,
      });
    });

    this.detachFns.push(this.props.sdk.entry.onSysChanged(this.onUpdate));
    this.props.sdk.window.startAutoResizer();
  }

  componentWillUnmount = () => {
    this.detachFns.forEach((detach) => detach());
  };

  constructState = () => {
    const sys = this.props.sdk.entry.getSys();

    return {
      working: false,
      isDraft: !sys.publishedVersion,
      hasPendingChanges: sys.version > (sys.publishedVersion || 0) + 1,
      isPublished: sys.version === (sys.publishedVersion || 0) + 1,
      displayFieldsMap: {},
    };
  };

  onError = (error) => {
    this.setState({ working: false });
    this.props.sdk.notifier.error(error.message);
  };

  onButtonClick = async () => {
    const result = await this.props.sdk.dialogs.openExtension({
      width: 800,
      title: 'The same extension rendered in modal window',
    });
    // eslint-disable-next-line no-console
    console.log(result);
  };

  onUpdate = () => {
    this.setState(this.constructState());
  };

  unpublishedReferences = (entry) => {
    const referenceFieldNames = [];
    const entryReferenceIds = [];

    for (const name in entry.fields) {
      const locale = this.props.sdk.locales.default;
      if (
        entry.fields[name][locale].sys &&
        entry.fields[name][locale].sys.type === 'Link' &&
        entry.fields[name][locale].sys.linkType === 'Entry'
      ) {
        referenceFieldNames.push(name);
        entryReferenceIds.push(entry.fields[name][locale].sys.id);
      }
    }

    return this.props.sdk.space
      .getEntries<Entry>({
        'sys.id[in]': entryReferenceIds.join(','),
      })
      .then((referenceEntries) => {
        return referenceEntries.items
          .filter((entry) => !entry.sys.publishedVersion)
          .map((entry, index) => ({
            field: referenceFieldNames[index],
            entry,
          }));
      });
  };

  getLinkedAndPublishedEntries = (entry) => {
    return this.props.sdk.space
      .getEntries<Entry>({
        links_to_entry: entry.sys.id,
      })
      .then((linkedEntries) => linkedEntries.items.filter((entry) => !!entry.sys.publishedVersion));
  };

  getEntryDisplayFieldValue = (entry) => {
    const displayField = this.state.displayFieldsMap[entry.sys.contentType.sys.id];

    return displayField ? entry.fields[displayField][this.props.sdk.locales.default] : entry.sys.id;
  };

  onClickUnpublish = async () => {
    this.setState({ working: true });

    const sdk = this.props.sdk;
    const sys = sdk.entry.getSys();

    const entry = await sdk.space.getEntry<Entry>(sys.id);

    const linkedAndPublishedEntries = await this.getLinkedAndPublishedEntries(entry);

    let title = 'Unpublish entry?';
    let message = 'This entry will be unpublished';

    let confirmLabel = 'Unpublish';
    if (linkedAndPublishedEntries.length > 0) {
      title = 'Entry is linked in other entries';
      confirmLabel = 'Unpublish anyway';
      message =
        `There are ${linkedAndPublishedEntries.length} entries that link to this entry: ` +
        linkedAndPublishedEntries.map(this.getEntryDisplayFieldValue).join(', ');
    }

    const result = await this.props.sdk.dialogs.openConfirm({
      title,
      message,
      confirmLabel,
      cancelLabel: 'Cancel',
    });

    if (!result) {
      this.setState({ working: false });
      return;
    }

    try {
      await sdk.space.unpublishEntry(entry);
      this.onUpdate();
    } catch (error) {
      this.onError(error);
    }
  };

  // Returns empty array if all required fields of the non-default locale are filled in
  // Otherwise, returns an array of the field names
  // Why? Because of the setting which enables content editors to publish empty
  getInvalidOptionalLocales = (): string[] => {
    const invalidRequiredFields = []
    const sdk = this.props.sdk

    for(const locale of sdk.locales.available) {
      const localeInvalidFields = []
      let localeAny = false
      for(const field of Object.keys(sdk.entry.fields)) {
        if(sdk.entry.fields[field].locales.includes(locale)) {
          const value = sdk.entry.fields[field].getForLocale(locale).getValue()
          if(sdk.entry.fields[field].required && !value) {
            localeInvalidFields.push(`${locale}: ${field}`)
          } else if(value) {
            localeAny = true
          }
        }
      }

      if(localeAny) {
        invalidRequiredFields.push(...localeInvalidFields)
      }
    }
    return invalidRequiredFields
  }

  onClickPublish = async () => {
    this.setState({ working: true });

    const sdk = this.props.sdk;
    const sys = sdk.entry.getSys();

    const entry = await sdk.space.getEntry(sys.id);
    const unpublishedReferences = await this.unpublishedReferences(entry);
    const invalidOptionalLocales = this.getInvalidOptionalLocales()

    let title = 'Publish entry?';
    let message = 'This entry will be published.';
    let confirmLabel = 'Publish';

    if (unpublishedReferences.length > 0) {
      title = 'You have unpublished links';
      message =
        'Not all links on this entry are published. See sections: ' +
        unpublishedReferences.map((ref) => ref.field).join(', ');
      confirmLabel = 'Publish anyway';
    }

    if (invalidOptionalLocales.length > 0) {
      title = 'Some required fields are not met'
      message =
        `If you only intend to publish ${sdk.locales.default}, please make sure that all fields of the other locale/s are empty. 
        Required fields are not met in the following: ${invalidOptionalLocales.join(', ')}.`
      confirmLabel = 'Understood'
      await this.props.sdk.dialogs.openAlert({
        title,
        message,
        confirmLabel
      })
      this.setState({ working: false })
      return
    }

    const result = await this.props.sdk.dialogs.openConfirm({
      title,
      message,
      confirmLabel,
      cancelLabel: 'Cancel',
    });

    if (!result) {
      this.setState({ working: false });
      return;
    }

    try {
      await sdk.space.publishEntry(entry);
      this.onUpdate();
    } catch (error) {
      this.onError(error);
    }
  };

  renderStatusLabel = () => {
    if (this.state.isPublished) {
      return 'Published';
    }

    if (this.state.isDraft) {
      return 'Draft';
    }

    return 'Published (pending changes)';
  };

  render = () => {
    const ago = relativeDate(new Date(this.props.sdk.entry.getSys().updatedAt));

    return (
      <>
        <Paragraph className="f36-margin-bottom--s">
          <strong>Status: </strong>
          {this.renderStatusLabel()}
        </Paragraph>
        <Button
          className="publish-button"
          buttonType="positive"
          isFullWidth={true}
          onClick={this.onClickPublish}
          disabled={this.state.isPublished || this.state.working}
          loading={this.state.working}>
          Publish
        </Button>
        <TextLink
          className="f36-margin-top--s f36-margin-bottom--xs"
          onClick={this.onClickUnpublish}>
          Unpublish
        </TextLink>
        <Paragraph>Last saved {ago}</Paragraph>
      </>
    );
  };
}

init((sdk) => {
  if (!sdk.location.is(locations.LOCATION_DIALOG)) {
    render(<SidebarExtension sdk={sdk as SidebarExtensionSDK} />, document.getElementById('root'));
  }
});

/**
 * By default, iframe of the extension is fully reloaded on every save of a source file.
 * If you want to use HMR (hot module reload) instead of full reload, uncomment the following lines
 */
// if (module.hot) {
//   module.hot.accept();
// }
