import { t } from '@lingui/macro'

export const navigationOptions = ({ navigation, screenProps }) => {
  const action = navigation.getParam(PARAM_ACTION)
  const isBridge = navigation.getParam('isBridge')

  return {
    title: action === ACTION_RECEIVE ? RECEIVE_TITLE : isBridge ? BRIDGE_TITLE : SEND_TITLE,
    isBridge,
  }
}

export const RECEIVE_TITLE = t`Receive G$`
export const SEND_TITLE = t`Send G$`
export const BRIDGE_TITLE = t`Bridge G$`
export const ACTION_RECEIVE = 'Receive'
export const ACTION_SEND = 'Send'
export const ACTION_SEND_TO_ADDRESS = 'SendToAddress'
export const PARAM_ACTION = 'action'
