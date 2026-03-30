import * as React from 'react'
import {IntlProvider, FormattedMessage, useIntl} from 'react-intl'

// Swedish messages with type-safe keys
const messages = {
  title: 'Hej FormatJS',
  content: 'Börja redigera för att se lite magi hända!',
  body: 'Din språkinställning ({locale}) är nu typsäker',
  welcome: 'Välkommen {name}',
  itemCount: 'Du har {count, plural, =0 {inga objekt} =1 {ett objekt} other {# objekt}}',
  currentTime: 'Nuvarande tid: {time, time}',
  description: 'Detta är ett exempel på typsäker internationalisering med svenska språket'
}

// Type declarations for Swedish locale support
declare global {
  namespace FormatjsIntl {
    interface Message {
      ids: keyof typeof messages
    }
    interface IntlConfig {
      locale: 'sv-SE' | 'sv' | 'en'
    }
  }
}

const SvenskKomponent = () => {
  // Här är locale typsäker (svenska kommentar!)
  const {locale} = useIntl()

  return (
    <div>
      <p>
        <FormattedMessage 
          id="body" 
          values={{locale}}
        />
      </p>
      <p>
        <FormattedMessage 
          id="welcome" 
          values={{name: 'Anna'}}
        />
      </p>
      <p>
        <FormattedMessage 
          id="itemCount" 
          values={{count: 5}}
        />
      </p>
      <p>
        <FormattedMessage 
          id="currentTime" 
          values={{time: new Date()}}
        />
      </p>
    </div>
  )
}

export default function SvensktStriktExample() {
  return (
    // Här är locale typsäker och begränsad till svenska
    <IntlProvider locale="sv-SE" messages={messages}>
      <div style={{fontFamily: 'system-ui', padding: '20px'}}>
        <h1>
          <FormattedMessage id="title" />
        </h1>
        <h2>
          <FormattedMessage id="content" />
        </h2>
        <p>
          <FormattedMessage id="description" />
        </p>
        <SvenskKomponent />
      </div>
    </IntlProvider>
  )
}