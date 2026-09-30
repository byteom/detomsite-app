package com.detomsite.adminapp

import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import kotlinx.coroutines.*
import com.detomsite.adminapp.databinding.ActivityLoginBinding

class LoginActivity : AppCompatActivity() {

    private lateinit var binding: ActivityLoginBinding
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityLoginBinding.inflate(layoutInflater)
        setContentView(binding.root)

        val p = getSharedPreferences("admin", Context.MODE_PRIVATE)
        if (p.getString("token", null) != null) {
            goMain()
            return
        }
        binding.etBaseUrl.setText(p.getString("base_url", "https://detomsite-backend.vercel.app"))
        binding.etUsername.setText(p.getString("username", ""))

        binding.btnLogin.setOnClickListener { doLogin() }
    }

    private fun doLogin() {
        val base = binding.etBaseUrl.text.toString().trim().trimEnd('/')
        val username = binding.etUsername.text.toString().trim()
        val password = binding.etPassword.text.toString()
        if (base.isEmpty() || username.isEmpty() || password.isEmpty()) {
            binding.tvStatus.text = "Fill in the URL, username and password."
            return
        }
        binding.tvStatus.text = "Signing in…"
        binding.btnLogin.isEnabled = false
        scope.launch {
            when (val r = ApiClient.login(base, username, password)) {
                is ApiResult.Ok -> {
                    val (token, name) = r.value
                    Session.save(this@LoginActivity, base, token, username, name)
                    withContext(Dispatchers.Main) { goMain() }
                }
                is ApiResult.Failure -> withContext(Dispatchers.Main) { err(r.message) }
                ApiResult.SessionExpired -> withContext(Dispatchers.Main) {
                    err("Sign-in failed — check your username and password.")
                }
            }
            withContext(Dispatchers.Main) { binding.btnLogin.isEnabled = true }
        }
    }

    private fun err(msg: String) {
        binding.tvStatus.text = msg
    }

    private fun goMain() {
        startActivity(Intent(this, MainActivity::class.java))
        finish()
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}