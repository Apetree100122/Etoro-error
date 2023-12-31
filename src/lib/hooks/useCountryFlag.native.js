// @flow
import React, { useMemo } from 'react'
import flags from 'react-native-phone-input/lib/resources/flags'
import Image from '../../components/common/view/Image'

const getCountryFlag = countryCode => {
  const code = countryCode.toLowerCase()
  return flags.get(code)
}

export const getCountryCodeForFlag = country => {
  switch (country) {
    // eslint-disable-next-line lines-around-comment
    // "Ascension Island".
    // The flag is missing for it:
    // https://lipis.github.io/flag-icon-css/flags/4x3/ac.svg
    // GitHub issue:
    // https://github.com/lipis/flag-icon-css/issues/537
    // Using "SH" flag as a temporary substitute
    // because previously "AC" and "TA" were parts of "SH".
    case 'AC':
      return 'SH'

    // "Tristan da Cunha".
    // The flag is missing for it:
    // https://lipis.github.io/flag-icon-css/flags/4x3/ta.svg
    // GitHub issue:
    // https://github.com/lipis/flag-icon-css/issues/537
    // Using "SH" flag as a temporary substitute
    // because previously "AC" and "TA" were parts of "SH".
    case 'TA':
      return 'SH'

    default:
      return country
  }
}

export default countryCode =>
  useMemo(() => {
    if (countryCode === undefined) {
      return
    }

    const code = getCountryCodeForFlag(countryCode)

    return <Image source={getCountryFlag(code)} style={{ width: 30, height: 30 }} />
  }, [countryCode])
