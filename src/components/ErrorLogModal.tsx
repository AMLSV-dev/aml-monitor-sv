import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, AlertCircle, Terminal, Copy, Check } from 'lucide-react';

interface ErrorLogModalProps {
  isOpen: boolean;
  onClose: () => void;
  errorLog: string[];
}

export const ErrorLogModal: React.FC<ErrorLogModalProps> = ({ isOpen, onClose, errorLog }) => {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = () => {
    const text = errorLog.join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm"
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 40 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 40 }}
            className="bg-white border-4 border-amber-400 rounded-[2.5rem] max-w-2xl w-full overflow-hidden shadow-[0_0_50px_rgba(251,191,36,0.3)] flex flex-col"
          >
            {/* Header */}
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-amber-50">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-amber-500 rounded-xl flex items-center justify-center shadow-lg shadow-amber-900/20 animate-pulse">
                  <AlertCircle className="text-white w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Incidencia Detectada</h2>
                  <p className="text-[10px] font-bold text-amber-600 uppercase tracking-widest">Consola de Diagnóstico • Cumplimiento SV</p>
                </div>
              </div>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-amber-200 rounded-full transition-all text-amber-600 hover:text-slate-900 group"
              >
                <X className="w-6 h-6 group-hover:rotate-90 transition-transform duration-300" />
              </button>
            </div>

            {/* Content */}
            <div className="p-8 space-y-6">
              <div className="bg-amber-100/50 border border-amber-200 p-4 rounded-2xl">
                <p className="text-amber-900 text-xs leading-relaxed font-medium">
                  Se ha registrado un evento inusual durante el proceso. Por favor, revisa el log a continuación y repórtalo si el problema persiste.
                </p>
              </div>

              <div className="relative group">
                <div className="absolute top-4 right-4 z-10">
                  <button 
                    onClick={handleCopy}
                    className="p-2 bg-slate-800 text-slate-400 hover:text-white rounded-lg transition-colors flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest"
                  >
                    {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    {copied ? 'Copiado' : 'Copiar Log'}
                  </button>
                </div>
                <div className="bg-slate-900 rounded-3xl p-6 font-mono text-[11px] text-emerald-400 overflow-y-auto max-h-[300px] border border-slate-800 shadow-inner">
                  <div className="flex items-center gap-2 mb-4 text-slate-500 border-b border-slate-800 pb-2">
                    <Terminal className="w-3 h-3" />
                    <span>SYSTEM_ERROR_LOG_V1</span>
                  </div>
                  {errorLog.length === 0 ? (
                    <p className="text-slate-600 italic">No hay registros disponibles.</p>
                  ) : (
                    errorLog.map((log, i) => (
                      <div key={i} className="py-1 border-b border-slate-800/30 last:border-0">
                        <span className="text-slate-600 mr-3">[{errorLog.length - i}]</span>
                        {log}
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="flex justify-center">
                <button 
                  onClick={onClose}
                  className="px-8 py-3 rounded-xl bg-slate-900 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg shadow-slate-900/20"
                >
                  Entendido, continuar
                </button>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-100 text-center">
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-[0.4em]">Reporte automático de depuración</p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
