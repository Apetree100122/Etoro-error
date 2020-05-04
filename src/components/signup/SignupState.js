// @flow
import React, { useEffect, useState } from 'react'
import { AsyncStorage, ScrollView, StyleSheet, View } from 'react-native'
import { createSwitchNavigator } from '@react-navigation/core'
import { isMobileSafari } from 'mobile-device-detect'
import { get } from 'lodash'
import {
  DESTINATION_PATH,
  GD_INITIAL_REG_METHOD,
  GD_USER_MNEMONIC,
  IS_LOGGED_IN,
} from '../../lib/constants/localStorage'
import { REGISTRATION_METHOD_SELF_CUSTODY, REGISTRATION_METHOD_TORUS } from '../../lib/constants/login'
import NavBar from '../appNavigation/NavBar'
import { navigationConfig } from '../appNavigation/navigationConfig'
import logger from '../../lib/logger/pino-logger'
import API from '../../lib/API/api'
import SimpleStore from '../../lib/undux/SimpleStore'
import { useDialog } from '../../lib/undux/utils/dialog'
import retryImport from '../../lib/utils/retryImport'
import { showSupportDialog } from '../common/dialogs/showSupportDialog'
import { getUserModel, type UserModel } from '../../lib/gundb/UserModel'
import Config from '../../config/config'
import { fireEvent } from '../../lib/analytics/analytics'
import type { SMSRecord } from './SmsForm'
import SignupCompleted from './SignupCompleted'
import EmailConfirmation from './EmailConfirmation'
import SmsForm from './SmsForm'
import PhoneForm from './PhoneForm'
import EmailForm from './EmailForm'
import NameForm from './NameForm'
import MagicLinkInfo from './MagicLinkInfo'

const log = logger.child({ from: 'SignupState' })

export type SignupState = UserModel & SMSRecord & { invite_code?: string }

type Ready = Promise<{ goodWallet: any, userStorage: any }>

const routes = {
  Name: NameForm,
  Phone: PhoneForm,
  SMS: SmsForm,
  Email: EmailForm,
  EmailConfirmation,
  SignupCompleted,
}

if (Config.enableSelfCustody) {
  Object.assign(routes, { MagicLinkInfo })
}

const SignupWizardNavigator = createSwitchNavigator(routes, navigationConfig)

const Signup = ({ navigation }: { navigation: any, screenProps: any }) => {
  const store = SimpleStore.useStore()

  // Getting the second element from routes array (starts from 0) as the second route is Phone
  // We are redirecting directly to Phone from Auth component if w3Token provided
  const _w3UserFromProps =
    get(navigation, 'state.params.w3User') ||
    get(navigation.state.routes.find(route => get(route, 'params.w3User')), 'params.w3User', {})
  const w3UserFromProps = _w3UserFromProps && typeof _w3UserFromProps === 'object' ? _w3UserFromProps : {}

  const w3Token =
    get(navigation, 'state.params.w3Token') ||
    get(navigation.state.routes.find(route => get(route, 'params.w3Token')), 'params.w3Token', undefined)

  const torusUserFromProps =
    get(navigation, 'state.params.torusUser') ||
    get(navigation.state.routes.find(route => get(route, 'params.torusUser')), 'params.torusUser', {})
  const _regMethod =
    get(navigation, 'state.params.regMethod') ||
    get(navigation.state.routes.find(route => get(route, 'params.regMethod')), 'params.regMethod', undefined)
  const _torusProvider =
    get(navigation, 'state.params.torusProvider') ||
    get(navigation.state.routes.find(route => get(route, 'params.torusProvider')), 'params.torusProvider', undefined)

  const [regMethod] = useState(_regMethod)
  const [torusProvider] = useState(_torusProvider)
  const isRegMethodSelfCustody = regMethod === REGISTRATION_METHOD_SELF_CUSTODY
  const isW3User = w3UserFromProps.email
  const skipEmail = isRegMethodSelfCustody === false || isW3User

  const initialState: SignupState = {
    ...getUserModel({
      email: w3UserFromProps.email || torusUserFromProps.email || '',
      fullName: w3UserFromProps.full_name || torusUserFromProps.name || '',
      mobile: '',
    }),
    smsValidated: false,
    isEmailConfirmed: skipEmail,
    jwt: '',
    skipEmail: skipEmail,
    skipEmailConfirmation: Config.skipEmailVerification || skipEmail,
    skipMagicLinkInfo: isRegMethodSelfCustody === false,
    w3Token,
  }

  const [ready, setReady]: [Ready, ((Ready => Ready) | Ready) => void] = useState()
  const [state, setState] = useState(initialState)
  const [loading, setLoading] = useState(false)
  const [countryCode, setCountryCode] = useState(undefined)
  const [createError, setCreateError] = useState(false)
  const [showNavBarGoBackButton, setShowNavBarGoBackButton] = useState(true)
  const [finishedPromise, setFinishedPromise] = useState(undefined)
  const [title, setTitle] = useState('Sign Up')
  const [, hideDialog, showErrorDialog] = useDialog()
  const shouldGrow = store.get && !store.get('isMobileSafariKeyboardShown')

  const navigateWithFocus = (routeKey: string) => {
    navigation.navigate(routeKey)
    setLoading(false)
    if (isMobileSafari || routeKey === 'Phone') {
      setTimeout(() => {
        const el = document.getElementById(routeKey + '_input')
        if (el) {
          el.focus()
        }
      }, 300)
    }
  }

  const fireSignupEvent = (event?: string, data) => {
    let curRoute = navigation.state.routes[navigation.state.index]

    fireEvent(`SIGNUP_${event || curRoute.key}`, data)
  }

  const getCountryCode = async () => {
    try {
      const { data } = await API.getLocation()
      data && setCountryCode(data.country)
    } catch (e) {
      log.error('Could not get user location', e.message, e)
    }
  }

  const verifyW3Email = async (email, web3Token) => {
    try {
      const res = await API.checkWeb3Email({
        email,
        token: web3Token,
      })
      log.debug('verified w3 email', res)
    } catch (e) {
      log.error('W3 Email verification failed', e.message, e)
      return navigation.navigate('InvalidW3TokenError')

      // showErrorDialog('Email verification failed', e)
    }
  }

  /**
   * fetch user details if not passed via w3UserFromProps
   * ie in case of page refresh
   */

  const checkW3Token = async () => {
    let w3Token
    try {
      w3Token = await AsyncStorage.getItem('GD_web3Token')
      if (!w3Token) {
        return
      }

      let w3User = w3UserFromProps
      log.info('from props:', { w3User })
      if (w3User.email == null) {
        store.set('loadingIndicator')({ loading: true })
        await API.ready

        try {
          const w3userData = await API.getUserFromW3ByToken(w3Token)

          w3User = w3userData.data
          log.info({ w3User })

          const userScreenData = {
            email: w3User.email || '',
            fullName: w3User.full_name || '',
            w3Token,
            isEmailConfirmed: !!w3User.email,
            skipEmail: !!w3User.email,
            skipEmailConfirmation: !!w3User.email,
          }
          setState({
            ...state,
            ...userScreenData,
          })
        } catch (e) {
          log.warn('could not get user data from w3', w3Token)
          return
        }
      }
    } catch (e) {
      log.error('unexpected error in checkWeb3Token', e.message, e, { w3Token })
    } finally {
      store.set('loadingIndicator')({ loading: false })
    }
  }

  //keep privatekey from torus as master seed before initializing wallet
  //so wallet can use it, if torus is enabled and we dont have pkey then require re-login
  //this is true in case of refresh
  const checkTorusLogin = () => {
    const masterSeed = torusUserFromProps.privateKey
    if (regMethod === REGISTRATION_METHOD_TORUS && masterSeed === undefined) {
      log.debug('torus user information missing', { torusUserFromProps })
      return navigation.navigate('Auth')
    }
    return !!masterSeed
  }

  const verifyStartRoute = () => {
    //we dont support refresh if regMethod param is missing then go back to Auth
    //if regmethod is missing it means user did refresh on later steps then first 1
    if (!regMethod) {
      log.debug('redirecting to start, got index:', navigation.state.index, { regMethod, torusUserFromProps })
      return navigation.navigate('Auth')
    }
  }

  // const verifyStartRoute = async () => {
  //   // don't allow to start sign up flow not from begining except when w3Token provided
  //   //or have info from torus login (ie name)
  //   const token = await AsyncStorage.getItem('GD_web3Token')

  //   log.debug('redirecting to start, got index:', navigation.state.index, { torusUserFromProps })

  //   if ((torusUserFromProps.name || token) && navigation.state.index > 1) {
  //     log.debug('redirecting to Phone skipping name')
  //     return navigateWithFocus(navigation.state.routes[1].key)
  //   }

  //   if (!(torusUserFromProps.name || token) === false && navigation.state.index > 0) {

  //     return navigateWithFocus(navigation.state.routes[0].key)
  //   }
  // }

  /**
   * if user arrived from w3 with an inviteCode, we forward it to the server
   * which registers the user on w3 with it
   */
  const checkW3InviteCode = async () => {
    const _destinationPath = await AsyncStorage.getItem(DESTINATION_PATH)
    const destinationPath = JSON.parse(_destinationPath)
    return get(destinationPath, 'params.inviteCode')
  }

  const onMount = async () => {
    verifyStartRoute()

    // // Recognize registration method (page refresh case included)
    // const initialRegMethod = await AsyncStorage.getItem(GD_INITIAL_REG_METHOD)

    // if (initialRegMethod && initialRegMethod !== regMethod) {
    //   setRegMethod(initialRegMethod)
    //   await AsyncStorage.setItem(GD_INITIAL_REG_METHOD, initialRegMethod)
    //   const skipEmailConfirmOrMagicLink = initialRegMethod !== REGISTRATION_METHOD_SELF_CUSTODY

    //   // set regMethod sensitive variables into state, they are already initialized only need to re-set if
    //   //regmethod has changed by refresh
    //   setState({
    //     ...state,
    //     skipEmail: skipEmailConfirmOrMagicLink,
    //     skipEmailConfirmation: Config.skipEmailVerification || skipEmailConfirmOrMagicLink,
    //     skipMagicLinkInfo: skipEmailConfirmOrMagicLink,
    //     isEmailConfirmed: skipEmailConfirmOrMagicLink || !!w3UserFromProps.email,
    //   })
    // }

    checkTorusLogin()

    //get user country code for phone
    //read user data from w3 if needed
    //read torus seed
    await Promise.all([getCountryCode(), checkW3Token()])

    //verify web3 email here
    if (Config.skipEmailVerification === false && state.w3Token && state.email) {
      verifyW3Email(state.email, state.w3Token)
    }

    //lazy login in background
    const ready = (async () => {
      log.debug('ready: Starting initialization', { w3UserFromProps, isRegMethodSelfCustody, torusUserFromProps })
      if (torusUserFromProps.privateKey) {
        log.debug('skipping ready initialization (already done in AuthTorus)')
        const [, { init }] = await Promise.all([API.ready, retryImport(() => import('../../init'))])
        return init()
      }

      const { init } = await retryImport(() => import('../../init'))
      const login = retryImport(() => import('../../lib/login/GoodWalletLogin'))
      const { goodWallet, userStorage, source } = await init()

      //for QA
      global.wallet = goodWallet
      await userStorage.ready
      fireSignupEvent('STARTED', { source })

      //the login also re-initialize the api with new jwt
      await login
        .then(l => l.default.auth())
        .catch(e => {
          log.error('failed auth:', e.message, e)

          // showErrorDialog('Failed authenticating with server', e)
        })

      await API.ready
      log.debug('ready: signupstate ready')

      //now that we are loggedin, reload api with JWT
      // await API.init()
      return { goodWallet, userStorage }
    })()

    setReady(ready)
  }

  useEffect(() => {
    onMount()
  }, [])

  const finishRegistration = async () => {
    setCreateError(false)
    setLoading(true)

    log.info('Sending new user data', state)
    try {
      const { goodWallet, userStorage } = await ready
      const inviteCode = await checkW3InviteCode()
      const { skipEmail, skipEmailConfirmation, skipMagicLinkInfo, ...requestPayload } = state

      ;['email', 'fullName', 'mobile'].forEach(field => {
        if (!requestPayload[field]) {
          const fieldNames = { email: 'Email', fullName: 'Name', mobile: 'Mobile' }
          throw new Error(`Seems like you didn't fill your ${fieldNames[field]}`)
        }
      })

      if (inviteCode) {
        requestPayload.inviteCode = inviteCode
      }

      if (regMethod === REGISTRATION_METHOD_TORUS) {
        requestPayload.torusProvider = torusProvider
      }

      let w3Token = requestPayload.w3Token
      if (w3Token) {
        userStorage.userProperties.set('cameFromW3Site', true)
      }

      userStorage.userProperties.set('regMethod', regMethod)
      requestPayload.regMethod = regMethod

      const mnemonic = (await AsyncStorage.getItem(GD_USER_MNEMONIC)) || ''
      await userStorage.setProfile({ ...requestPayload, walletAddress: goodWallet.account, mnemonic }).catch(_ => _)

      // Stores creationBlock number into 'lastBlock' feed's node
      goodWallet
        .getBlockNumber()
        .then(creationBlock => userStorage.saveLastBlockNumber(creationBlock.toString()))
        .catch(e => log.error('save blocknumber failed:', e.message, e))

      //first need to add user to our database
      const addUserAPIPromise = API.addUser(requestPayload).then(res => {
        const data = res.data

        if (data && data.loginToken) {
          userStorage.setProfileField('loginToken', data.loginToken, 'private').catch()
        }

        if (data && data.w3Token) {
          userStorage.setProfileField('w3Token', data.w3Token, 'private').catch()
          w3Token = data.w3Token
        }

        if (data && data.marketToken) {
          userStorage.setProfileField('marketToken', data.marketToken, 'private').catch()
        }
      })

      await addUserAPIPromise

      //need to wait for API.addUser but we dont need to wait for it to finish
      Promise.all([
        w3Token &&
          API.updateW3UserWithWallet(w3Token, goodWallet.account).catch(e =>
            log.error('failed updateW3UserWithWallet', e.message, e)
          ),
      ])

      userStorage.setProfileField('registered', true, 'public').catch(_ => _)
      userStorage.gunuser.get('registered').put(true)
      await AsyncStorage.setItem(IS_LOGGED_IN, true)

      AsyncStorage.removeItem('GD_web3Token')
      AsyncStorage.removeItem(GD_INITIAL_REG_METHOD)

      log.debug('New user created')
      setLoading(false)
      return true
    } catch (e) {
      log.error('New user failure', e.message, e)
      showSupportDialog(showErrorDialog, hideDialog, navigation.navigate, e.message)

      // showErrorDialog('Something went on our side. Please try again')
      setCreateError(true)
      return false
    } finally {
      setLoading(false)
    }
  }

  const waitForRegistrationToFinish = async () => {
    try {
      let ok
      if (createError) {
        ok = await finishRegistration()
      } else {
        ok = await finishedPromise
      }
      log.debug('user registration synced and completed', { ok })
      return ok
    } catch (e) {
      log.error('waiting for user registration failed', e.message, e)
      return false
    } finally {
      setLoading(false)
    }
  }

  function getNextRoute(routes, routeIndex, state) {
    let nextRoute = routes[routeIndex + 1]

    if (state[`skip${nextRoute && nextRoute.key}`]) {
      return getNextRoute(routes, routeIndex + 1, state)
    }

    return nextRoute
  }

  function getPrevRoute(routes, routeIndex, state) {
    let prevRoute = routes[routeIndex - 1]

    if (state[`skip${prevRoute && prevRoute.key}`]) {
      return getPrevRoute(routes, routeIndex - 1, state)
    }

    return prevRoute
  }

  const done = async (data: { [string]: string }) => {
    setLoading(true)
    fireSignupEvent()
    await ready

    log.info('signup data:', { data })

    let nextRoute = getNextRoute(navigation.state.routes, navigation.state.index, state)

    const newState = { ...state, ...data }
    setState(newState)
    log.info('signup data:', { data, nextRoute, newState })

    if (nextRoute === undefined) {
      const ok = await waitForRegistrationToFinish()

      //this will cause a re-render and move user to the dashboard route
      if (ok) {
        store.set('isLoggedIn')(true)
      }
    } else if (nextRoute && nextRoute.key === 'SMS') {
      try {
        let { data } = await API.sendOTP(newState)
        if (data.ok === 0) {
          const errorMessage =
            data.error === 'mobile_already_exists' ? 'Mobile already exists, please use a different one' : data.error

          return showSupportDialog(showErrorDialog, hideDialog, navigation.navigate, errorMessage)
        }
        return navigateWithFocus(nextRoute.key)
      } catch (e) {
        log.error('Send mobile code failed', e.message, e)
        return showErrorDialog('Could not send verification code. Please try again')
      } finally {
        setLoading(false)
      }
    } else if (nextRoute && nextRoute.key === 'EmailConfirmation') {
      try {
        setLoading(true)
        const { data } = await API.sendVerificationEmail(newState)
        if (data.ok === 0) {
          return showErrorDialog('Could not send verification email. Please try again')
        }
        log.debug('skipping email verification?', { ...data, skip: Config.skipEmailVerification })
        if (Config.skipEmailVerification || data.onlyInEnv) {
          // Server is using onlyInEnv middleware (probably dev mode), email verification is not sent.

          // Skip EmailConfirmation screen
          nextRoute = navigation.state.routes[navigation.state.index + 2]

          // Set email as confirmed
          setState({ ...newState, isEmailConfirmed: true })
        }

        return navigateWithFocus(nextRoute.key)
      } catch (e) {
        log.error('email verification failed unexpected:', e.message, e)
        return showErrorDialog('Could not send verification email. Please try again', 'EMAIL-UNEXPECTED-1')
      } finally {
        setLoading(false)
      }
    } else if (nextRoute.key === 'MagicLinkInfo') {
      let ok = await waitForRegistrationToFinish()
      if (ok) {
        const { userStorage } = await ready
        if (isRegMethodSelfCustody) {
          API.sendMagicLinkByEmail(userStorage.getMagicLink())
            .then(r => log.info('magiclink sent'))
            .catch(e => log.error('failed sendMagicLinkByEmail', e.message, e))
        }
        return navigateWithFocus(nextRoute.key)
      }
    } else if (nextRoute) {
      return navigateWithFocus(nextRoute.key)
    }
  }

  const back = () => {
    const prevRoute = getPrevRoute(navigation.state.routes, navigation.state.index, state)

    if (prevRoute) {
      navigateWithFocus(prevRoute.key)
    } else {
      navigation.navigate('Auth')
    }
  }

  useEffect(() => {
    const curRoute = navigation.state.routes[navigation.state.index]

    if (state === initialState) {
      return
    }

    if (curRoute && curRoute.key === 'MagicLinkInfo') {
      setTitle('Magic Link')
      setShowNavBarGoBackButton(false)
    }
    if (curRoute && curRoute.key === 'SignupCompleted') {
      const finishedPromise = finishRegistration()
      setFinishedPromise(finishedPromise)
    }
  }, [navigation.state.index])

  const { scrollableContainer, contentContainer } = styles
  return (
    <View style={{ flexGrow: shouldGrow ? 1 : 0 }}>
      <NavBar goBack={showNavBarGoBackButton ? back : undefined} title={title} />
      <ScrollView contentContainerStyle={scrollableContainer}>
        <View style={contentContainer}>
          <SignupWizardNavigator
            navigation={navigation}
            screenProps={{
              data: { ...state, loading, createError, countryCode },
              doneCallback: done,
              back,
            }}
          />
        </View>
      </ScrollView>
    </View>
  )
}

Signup.router = SignupWizardNavigator.router
Signup.navigationOptions = SignupWizardNavigator.navigationOptions

const styles = StyleSheet.create({
  contentContainer: {
    flexGrow: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  scrollableContainer: {
    flexGrow: 1,
  },
})

export default Signup
