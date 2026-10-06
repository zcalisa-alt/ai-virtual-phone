package app.floatphone.shell

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

object LocalPushConfig {
 private fun prefs(context:Context)=context.getSharedPreferences("float_local_push",Context.MODE_PRIVATE)
 private fun key():SecretKey {
  val store=KeyStore.getInstance("AndroidKeyStore").apply{load(null)}
  if(!store.containsAlias("FloatLocalPush")){KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore").apply{init(KeyGenParameterSpec.Builder("FloatLocalPush",KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())}.generateKey()}
  return store.getKey("FloatLocalPush",null) as SecretKey
 }
 fun token(context:Context):String?=runCatching {
  val bytes=Base64.decode(prefs(context).getString("token",null)?:return@runCatching null,Base64.NO_WRAP)
  val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),GCMParameterSpec(128,bytes.copyOfRange(0,12)));String(cipher.doFinal(bytes.copyOfRange(12,bytes.size)),Charsets.UTF_8)
 }.getOrNull()
 fun enabled(context:Context)=prefs(context).getBoolean("enabled",false)
 fun configure(context:Context,token:String,enabled:Boolean){
  require(!enabled||token.length in 32..1024)
  val editor=prefs(context).edit()
  if(!enabled){editor.remove("token").putBoolean("enabled",false).apply();return}
  if(this.token(context)!=token)editor.putLong("sequence",0)
  val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());editor.putString("token",Base64.encodeToString(cipher.iv+cipher.doFinal(token.toByteArray()),Base64.NO_WRAP)).putBoolean("enabled",true).apply()
 }
 fun sequence(context:Context)=prefs(context).getLong("sequence",0)
 fun seen(context:Context,sequence:Long){prefs(context).edit().putLong("sequence",sequence).putLong("connectedAt",System.currentTimeMillis()).apply()}
 fun connectedAt(context:Context)=prefs(context).getLong("connectedAt",0)
}
