import { useState } from 'react';
import toast from 'react-hot-toast';
import authConfig from '../config/auth.json';

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (username === authConfig.username && password === authConfig.password) {
      onLogin();
      toast.success('登录成功');
    } else {
      toast.error('账号或密码错误');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-neutral-950 flex items-center justify-center p-4 font-sans transition-colors duration-200">
      <div className="bg-white dark:bg-neutral-900 p-10 rounded-[2.5rem] border border-gray-100 dark:border-neutral-800 w-full max-w-md shadow-2xl shadow-violet-500/5">
        <div className="text-center mb-10">
          <div className="w-16 h-16 bg-violet-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-violet-500/20">
            <span className="text-white text-2xl font-black italic">O</span>
          </div>
          <h1 className="text-2xl font-black text-gray-900 dark:text-white mb-2 tracking-tight uppercase">系统登录</h1>
          <p className="text-[10px] font-black text-gray-400 dark:text-neutral-500 uppercase tracking-widest">请输入账号和密码以继续访问</p>
        </div>
        
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-[10px] font-black text-gray-400 dark:text-neutral-500 mb-2 uppercase tracking-widest">账号</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-gray-50 dark:bg-neutral-950 border border-gray-100 dark:border-neutral-800 rounded-2xl px-5 py-4 text-gray-900 dark:text-white placeholder-gray-300 dark:placeholder-neutral-700 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all font-medium"
              placeholder="请输入账号"
              required
            />
          </div>
          
          <div>
            <label className="block text-[10px] font-black text-gray-400 dark:text-neutral-500 mb-2 uppercase tracking-widest">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-gray-50 dark:bg-neutral-950 border border-gray-100 dark:border-neutral-800 rounded-2xl px-5 py-4 text-gray-900 dark:text-white placeholder-gray-300 dark:placeholder-neutral-700 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all font-medium"
              placeholder="请输入密码"
              required
            />
          </div>
          
          <button
            type="submit"
            className="w-full bg-violet-600 text-white font-black py-4 rounded-2xl hover:bg-violet-700 active:scale-[0.98] transition-all mt-4 uppercase tracking-widest text-[10px] shadow-lg shadow-violet-500/20"
          >
            登录系统
          </button>
        </form>
      </div>
    </div>
  );
}
