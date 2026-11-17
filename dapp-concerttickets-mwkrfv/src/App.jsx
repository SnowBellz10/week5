import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ethers } from 'ethers';

const TARGET_CHAIN_ID = 560048;
const TARGET_CHAIN_HEX = '0x88bb0';
const config = window.__QUICK_DAPP_CONFIG__ || {};
const title = config.title || 'My DApp';
const bindings = Array.isArray(config.contracts) ? config.contracts : [];
const binding = bindings.find((item) => item.id === config.primaryContractId);

function configurationError() {
  try {
    if (!binding || !ethers.isAddress(binding.address) || !Array.isArray(binding.abi) || !binding.abi.length || String(binding.chainId) !== String(TARGET_CHAIN_ID)) throw new Error();
    const iface = new ethers.Interface(binding.abi);
    for (const name of ['ticketPrice', 'soldTickets', 'totalTickets', 'checkMyTicket', 'buyTicket']) {
      if (!iface.getFunction(name)) throw new Error();
    }
    return '';
  } catch {
    return 'ไม่พบข้อมูลสัญญาที่ถูกต้อง กรุณาตรวจสอบการตั้งค่า DApp';
  }
}
const configError = configurationError();

function timeout(promise, message) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), 45000); }),
  ]).finally(() => clearTimeout(timer));
}
function errorText(error) {
  if (error?.code === 4001 || error?.code === 'ACTION_REJECTED') return 'คุณปฏิเสธคำขอในกระเป๋า';
  return error?.shortMessage || error?.reason || error?.message || 'เกิดข้อผิดพลาด กรุณาลองอีกครั้ง';
}
function shortAddress(address) { return `${address.slice(0, 6)}…${address.slice(-4)}`; }

export default function App() {
  const rawRef = useRef(null);
  const listenersRef = useRef(null);
  const generationRef = useRef(0);
  const connectBusyRef = useRef(false);
  const txBusyRef = useRef(false);
  const [session, setSession] = useState(null);
  const [data, setData] = useState(null);
  const [loadingData, setLoadingData] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [notice, setNotice] = useState(null);
  const [transaction, setTransaction] = useState({ phase: 'idle', hash: '' });

  const removeListeners = useCallback(() => {
    const saved = listenersRef.current;
    if (saved && typeof saved.raw.removeListener === 'function') {
      saved.raw.removeListener('accountsChanged', saved.onAccountsChanged);
      saved.raw.removeListener('chainChanged', saved.onChainChanged);
    }
    listenersRef.current = null;
  }, []);

  const disconnect = useCallback(() => {
    generationRef.current += 1;
    removeListeners();
    rawRef.current = null;
    setSession(null);
    setData(null);
    setLoadingData(false);
    setNotice(null);
    setTransaction({ phase: 'idle', hash: '' });
    try { localStorage.removeItem('__qdapp_wallet_rdns'); } catch { /* storage may be unavailable */ }
  }, [removeListeners]);

  useEffect(() => () => {
    generationRef.current += 1;
    removeListeners();
    rawRef.current = null;
  }, [removeListeners]);

  const connect = async () => {
    if (connectBusyRef.current) return;
    connectBusyRef.current = true;
    setConnecting(true);
    setNotice(null);
    const generation = ++generationRef.current;
    removeListeners();
    rawRef.current = null;
    setSession(null);
    setData(null);
    try {
      const rawProvider = await timeout(window.__qdapp_getProvider ? window.__qdapp_getProvider() : window.ethereum, 'ค้นหากระเป๋าไม่สำเร็จภายใน 45 วินาที กรุณาตรวจสอบ MetaMask แล้วลองใหม่');
      if (!rawProvider?.request) throw new Error('ไม่พบกระเป๋า กรุณาติดตั้งหรือเปิด MetaMask แล้วลองอีกครั้ง');
      console.info('[QDBinding] wallet.connect', { stage: 'provider-selected' });
      const accounts = await timeout(rawProvider.request({ method: 'eth_requestAccounts' }), 'การเชื่อมต่อหมดเวลา กรุณาเปิด MetaMask และลองอีกครั้ง');
      console.info('[QDBinding] wallet.connect', { stage: 'accounts-authorized' });
      if (!Array.isArray(accounts) || !accounts.length) throw new Error('ไม่พบบัญชีที่ได้รับอนุญาต กรุณาเชื่อมต่อ MetaMask อีกครั้ง');
      const provider = new ethers.BrowserProvider(rawProvider);
      const network = await provider.getNetwork();
      const signer = await provider.getSigner(accounts[0]);
      if (generation !== generationRef.current) return;
      console.info('[QDBinding] wallet.connect', { stage: 'connected' });
      rawRef.current = rawProvider;

      async function syncSession() {
        const eventGeneration = ++generationRef.current;
        setSession(null);
        setData(null);
        setNotice(null);
        try {
          const nextAccounts = await rawProvider.request({ method: 'eth_accounts' });
          if (eventGeneration !== generationRef.current || rawRef.current !== rawProvider) return;
          if (!Array.isArray(nextAccounts) || !nextAccounts.length) {
            removeListeners();
            rawRef.current = null;
            setSession(null);
            setData(null);
            setTransaction({ phase: 'idle', hash: '' });
            return;
          }
          const nextProvider = new ethers.BrowserProvider(rawProvider);
          const nextNetwork = await nextProvider.getNetwork();
          const nextSigner = await nextProvider.getSigner(nextAccounts[0]);
          if (eventGeneration !== generationRef.current || rawRef.current !== rawProvider) return;
          setSession({ account: nextAccounts[0], chainId: Number(nextNetwork.chainId), provider: nextProvider, signer: nextSigner });
        } catch (error) {
          if (eventGeneration === generationRef.current) setNotice({ type: 'error', text: errorText(error) });
        }
      }
      function onAccountsChanged() { void syncSession(); }
      function onChainChanged() { void syncSession(); }
      if (typeof rawProvider.on === 'function') {
        rawProvider.on('accountsChanged', onAccountsChanged);
        rawProvider.on('chainChanged', onChainChanged);
        listenersRef.current = { raw: rawProvider, onAccountsChanged, onChainChanged };
      }
      setTransaction({ phase: 'idle', hash: '' });
      setSession({ account: accounts[0], chainId: Number(network.chainId), provider, signer });
    } catch (error) {
      if (generation === generationRef.current) setNotice({ type: 'error', text: errorText(error) });
    } finally {
      connectBusyRef.current = false;
      setConnecting(false);
    }
  };

  const switchNetwork = async () => {
    if (!rawRef.current || switching) return;
    setSwitching(true);
    setNotice(null);
    try {
      await rawRef.current.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: TARGET_CHAIN_HEX }] });
    } catch (error) {
      if (error?.code === 4902 || error?.data?.originalError?.code === 4902) {
        setNotice({ type: 'error', text: 'ยังไม่มีเครือข่าย Hoodi ใน MetaMask กรุณาเพิ่มเครือข่าย Hoodi ในกระเป๋าก่อน แล้วลองอีกครั้ง' });
      } else setNotice({ type: 'error', text: errorText(error) });
    } finally { setSwitching(false); }
  };

  useEffect(() => {
    let cancelled = false;
    setData(null);
    if (!session || session.chainId !== TARGET_CHAIN_ID || configError) {
      setLoadingData(false);
      return () => { cancelled = true; };
    }
    async function load() {
      setLoadingData(true);
      try {
        const contract = new ethers.Contract(binding.address, binding.abi, session.signer);
        const [price, sold, total, ticket] = await Promise.all([
          contract.ticketPrice(), contract.soldTickets(), contract.totalTickets(), contract.checkMyTicket(),
        ]);
        if (!cancelled) {
          setData({ price, sold, total, ticketId: ticket.ticketId ?? ticket[0], purchased: ticket.purchased ?? ticket[1] });
        }
      } catch (error) {
        if (!cancelled) setNotice({ type: 'error', text: `โหลดข้อมูลสัญญาไม่สำเร็จ: ${errorText(error)}` });
      } finally { if (!cancelled) setLoadingData(false); }
    }
    void load();
    return () => { cancelled = true; };
  }, [session, refreshIndex]);

  const buy = async () => {
    if (txBusyRef.current || !session || session.chainId !== TARGET_CHAIN_ID || !data || data.purchased || data.sold >= data.total || configError) return;
    txBusyRef.current = true;
    const actionGeneration = generationRef.current;
    setNotice(null);
    setTransaction({ phase: 'signing', hash: '' });
    try {
      const contract = new ethers.Contract(binding.address, binding.abi, session.signer);
      const price = await contract.ticketPrice();
      if (actionGeneration !== generationRef.current) throw new Error('บัญชีหรือเครือข่ายเปลี่ยนไป กรุณาลองอีกครั้ง');
      const tx = await contract.buyTicket({ value: price });
      if (actionGeneration === generationRef.current) setTransaction({ phase: 'pending', hash: tx.hash });
      const receipt = await tx.wait();
      if (!receipt || receipt.status !== 1) throw new Error('ธุรกรรมไม่สำเร็จ');
      if (actionGeneration === generationRef.current) {
        setTransaction({ phase: 'success', hash: tx.hash });
        setRefreshIndex((value) => value + 1);
      }
    } catch (error) {
      if (actionGeneration === generationRef.current) {
        setTransaction({ phase: 'idle', hash: '' });
        setNotice({ type: 'error', text: errorText(error) });
      }
    } finally { txBusyRef.current = false; }
  };

  const correctNetwork = session?.chainId === TARGET_CHAIN_ID;
  const busy = transaction.phase === 'signing' || transaction.phase === 'pending';
  const remaining = data ? (data.total > data.sold ? data.total - data.sold : 0n) : null;
  const buyDisabled = !session || !correctNetwork || !data || loadingData || data.purchased || remaining === 0n || busy || !!configError;
  const buyLabel = busy ? (transaction.phase === 'signing' ? 'รอยืนยันในกระเป๋า…' : 'รอยืนยันธุรกรรม…') : data?.purchased ? 'คุณมีตั๋วแล้ว' : remaining === 0n ? 'ตั๋วหมดแล้ว' : 'ซื้อตั๋ว';

  return (
    <div className="min-h-screen">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-5 py-5 sm:px-8 lg:px-12">
          <div className="flex min-w-0 items-center gap-3">
            {config.logo ? <img src={config.logo} alt="" className="h-9 w-9 rounded object-contain" /> : <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#C84B31] text-[#E7664B] font-mono-code text-xs">●</span>}
            <span className="truncate text-sm font-bold tracking-wide">{title}</span>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <span className="hidden font-mono-code text-[10px] tracking-[.14em] text-[#B9AA99] sm:block">HOODI TESTNET</span>
            {session ? <button onClick={disconnect} className="rounded-full border border-white/20 px-4 py-2.5 text-xs font-semibold hover:border-white/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#D4A359]">ออกจากระบบ</button> : <button onClick={connect} disabled={connecting} className="rounded-full bg-[#F4ECE1] px-4 py-2.5 text-xs font-bold text-[#181512] hover:bg-white disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#D4A359]">{connecting ? 'กำลังเชื่อมต่อ…' : 'เชื่อมต่อ MetaMask'}</button>}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 pb-20 pt-12 sm:px-8 sm:pt-16 lg:px-12">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="mb-3 font-mono-code text-[10px] font-semibold tracking-[.25em] text-[#D4A359]">THE CONCERT EXPERIENCE / ON-CHAIN</p>
            <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-5xl">ตั๋วคอนเสิร์ต<span className="text-[#C84B31]">.</span></h1>
            <p className="mt-3 text-sm leading-relaxed text-[#B3A79B]">ตั๋วของคุณ บันทึกไว้บนบล็อกเชน</p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[.03] px-3 py-2 font-mono-code text-[10px] tracking-wide text-[#C9BFB3]"><span className={`h-2 w-2 rounded-full ${session && correctNetwork ? 'bg-[#86B98C]' : 'bg-[#D4A359]'}`}></span>{session ? (correctNetwork ? 'HOODI CONNECTED' : 'WRONG NETWORK') : 'WALLET NOT CONNECTED'}</div>
        </div>

        {configError && <div role="alert" className="mb-5 rounded-xl border border-red-400/40 bg-red-950/40 p-4 text-sm text-red-200">{configError}</div>}
        {session && !correctNetwork && <div className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#D4A359]/35 bg-[#D4A359]/10 p-4"><p className="text-sm text-[#F0D5A6]">เครือข่ายไม่ถูกต้อง กรุณาเปลี่ยนเป็น Hoodi (Chain ID 560048)</p><button onClick={switchNetwork} disabled={switching} className="rounded-full bg-[#D4A359] px-5 py-2 text-xs font-bold text-[#181512] hover:bg-[#E4B56D] disabled:opacity-50">{switching ? 'กำลังเปลี่ยน…' : 'เปลี่ยนเป็น Hoodi'}</button></div>}
        {notice && <div role="alert" className="mb-5 rounded-xl border border-red-400/40 bg-red-950/40 p-4 text-sm leading-relaxed text-red-200">{notice.text}</div>}
        {busy && <div role="status" className="mb-5 rounded-xl border border-[#D4A359]/35 bg-[#D4A359]/10 p-4 text-sm text-[#F0D5A6]">{transaction.phase === 'signing' ? 'กำลังรอการยืนยันใน MetaMask' : 'ส่งธุรกรรมแล้ว กำลังรอการยืนยันบนเครือข่าย'} {transaction.hash && <span className="break-all font-mono-code text-xs">{transaction.hash}</span>}</div>}
        {transaction.phase === 'success' && <div role="status" className="mb-5 rounded-xl border border-emerald-500/35 bg-emerald-950/40 p-4 text-sm text-emerald-200">ซื้อตั๋วสำเร็จแล้ว <span className="break-all font-mono-code text-xs">{transaction.hash}</span></div>}

        <section className="ticket-card grid overflow-hidden lg:grid-cols-[1.35fr_0.85fr]" aria-label="ข้อมูลตั๋วคอนเสิร์ต">
          <div className="p-6 sm:p-10 lg:p-12">
            <div className="flex items-start justify-between gap-4 border-b border-[#181512]/15 pb-6">
              <div><p className="font-mono-code text-[10px] font-semibold tracking-[.2em] text-[#9B492E]">ADMISSION / 01</p><h2 className="mt-3 text-2xl font-bold sm:text-3xl">บัตรเข้าชมคอนเสิร์ต</h2></div>
              <div className="rounded-full border border-[#181512]/20 px-3 py-1.5 font-mono-code text-[10px] font-semibold">HOODI</div>
            </div>
            <div className="grid grid-cols-2 gap-5 py-8 sm:py-10">
              <div><p className="mb-2 text-xs text-[#71675D]">ราคาตั๋ว</p><p className="break-all font-mono-code text-2xl font-semibold sm:text-3xl">{data ? ethers.formatEther(data.price) : '—'} <span className="text-sm text-[#71675D]">ETH</span></p></div>
              <div><p className="mb-2 text-xs text-[#71675D]">ตั๋วคงเหลือ</p><p className="font-mono-code text-2xl font-semibold sm:text-3xl">{remaining !== null ? remaining.toString() : '—'} <span className="text-sm text-[#71675D]">ใบ</span></p>{data && <p className="mt-2 text-xs text-[#71675D]">จากทั้งหมด {data.total.toString()} ใบ</p>}</div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[#181512]/15 pt-6">
              <div><p className="mb-1 text-xs text-[#71675D]">บัญชีที่เชื่อมต่อ</p><p className="break-all font-mono-code text-xs font-medium">{session ? session.account : 'ยังไม่ได้เชื่อมต่อกระเป๋า'}</p></div>
              {session && correctNetwork && <button onClick={() => { setNotice(null); setRefreshIndex((v) => v + 1); }} disabled={loadingData || busy} className="text-xs font-semibold text-[#9B492E] underline underline-offset-4 disabled:opacity-50">{loadingData ? 'กำลังโหลด…' : 'อัปเดตข้อมูล'}</button>}
            </div>
          </div>

          <div className="ticket-divider flex flex-col justify-between bg-[#EAE0D2] p-6 sm:p-10 lg:p-12">
            <div><div className="flex items-center justify-between gap-4"><p className="font-mono-code text-[10px] font-semibold tracking-[.2em] text-[#9B492E]">YOUR TICKET</p><span className="font-mono-code text-xs text-[#71675D]">NO. 01</span></div>
              <h3 className="mt-5 text-xl font-bold">ตั๋วของฉัน</h3>
              <p className="mt-2 text-sm leading-relaxed text-[#71675D]">หนึ่งบัญชีสามารถซื้อได้หนึ่งใบ</p>
              <div className="mt-7 space-y-3 border-y border-[#181512]/15 py-5 text-sm"><div className="flex justify-between gap-4"><span className="text-[#71675D]">Ticket ID</span><span className="break-all font-mono-code font-semibold">{data ? data.ticketId.toString() : '—'}</span></div><div className="flex justify-between gap-4"><span className="text-[#71675D]">Purchased</span><span className="font-mono-code font-semibold">{data ? String(data.purchased) : '—'}</span></div></div>
              {data?.purchased && <div className="mt-5 inline-block stamp-badge rounded px-3 py-1 text-xs font-bold">มีตั๋วแล้ว / PURCHASED</div>}
            </div>
            <div className="mt-8"><button onClick={buy} disabled={buyDisabled} className="w-full rounded-lg bg-[#C84B31] px-5 py-4 text-sm font-bold text-white transition-colors hover:bg-[#DF583C] disabled:cursor-not-allowed disabled:bg-[#A99B8D] disabled:text-[#F4ECE1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9B492E]">{buyLabel} <span aria-hidden="true" className="ml-2">↗</span></button><p className="mt-3 text-center text-xs leading-relaxed text-[#71675D]">{!session ? 'เชื่อมต่อกระเป๋าเพื่อดูข้อมูลและซื้อตั๋ว' : !correctNetwork ? 'เปลี่ยนเครือข่ายเป็น Hoodi เพื่อดำเนินการ' : 'ชำระด้วย ETH ตามราคาที่อ่านจากสัญญา'}</p></div>
          </div>
        </section>
        <footer className="mt-8 flex flex-wrap items-center justify-between gap-4 text-[#82776B]"><p className="text-xs">ข้อมูลและการซื้อตั๋วเชื่อมต่อกับสัญญาที่ Deploy แล้ว</p><p className="font-mono-code text-[10px] tracking-[.14em]">POWERED BY ETHEREUM / HOODI</p></footer>
      </main>
    </div>
  );
}
