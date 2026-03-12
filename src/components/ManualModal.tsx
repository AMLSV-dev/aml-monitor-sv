import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Shield, Search, Zap, AlertCircle, MessageSquare, BookOpen } from 'lucide-react';

interface ManualModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ManualModal: React.FC<ManualModalProps> = ({ isOpen, onClose }) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md"
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            className="bg-white border border-slate-200 rounded-[2.5rem] max-w-4xl w-full max-h-[90vh] overflow-hidden shadow-2xl flex flex-col"
          >
            {/* Header */}
            <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-900/20">
                  <BookOpen className="text-white w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-xl font-serif font-bold text-slate-900">Manual de Usuario</h2>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Cumplimiento SV • Guía Rápida</p>
                </div>
              </div>
              <button 
                onClick={onClose}
                className="p-3 hover:bg-slate-200 rounded-full transition-all text-slate-400 hover:text-slate-900 group"
                aria-label="Cerrar"
              >
                <X className="w-6 h-6 group-hover:rotate-90 transition-transform duration-300" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-10">
              <div className="space-y-12">
                {/* Intro */}
                <section>
                  <div className="flex items-center gap-3 mb-4">
                    <Shield className="w-5 h-5 text-blue-600" />
                    <h3 className="text-lg font-bold text-slate-900">Bienvenido a Cumplimiento SV</h3>
                  </div>
                  <p className="text-slate-600 text-sm leading-relaxed">
                    Nuestra plataforma está diseñada para automatizar la debida diligencia y el monitoreo de noticias de riesgo AML (Anti-Money Laundering) en El Salvador. 
                    Utilizamos inteligencia artificial avanzada para transformar texto desestructurado en hallazgos accionables para oficiales de cumplimiento y APNFDs.
                  </p>
                </section>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                  {/* FGR Search */}
                  <section className="bg-slate-50 p-6 rounded-3xl border border-slate-100">
                    <div className="flex items-center gap-3 mb-4">
                      <Search className="w-5 h-5 text-emerald-600" />
                      <h4 className="font-bold text-slate-900">Búsqueda FGR SV</h4>
                    </div>
                    <ul className="text-xs text-slate-500 space-y-3">
                      <li className="flex gap-2">
                        <span className="text-emerald-500 font-bold">01.</span>
                        <span>Selecciona "FGR SV" como fuente de búsqueda.</span>
                      </li>
                      <li className="flex gap-2">
                        <span className="text-emerald-500 font-bold">02.</span>
                        <span>Define el rango de fechas y la profundidad (páginas a recorrer).</span>
                      </li>
                      <li className="flex gap-2">
                        <span className="text-emerald-500 font-bold">03.</span>
                        <span>Haz clic en "Extraer FGR" para traer los comunicados oficiales a la Bandeja.</span>
                      </li>
                    </ul>
                  </section>

                  {/* Digital Media */}
                  <section className="bg-slate-50 p-6 rounded-3xl border border-slate-100">
                    <div className="flex items-center gap-3 mb-4">
                      <Zap className="w-5 h-5 text-blue-600" />
                      <h4 className="font-bold text-slate-900">Medios Digitales</h4>
                    </div>
                    <ul className="text-xs text-slate-500 space-y-3">
                      <li className="flex gap-2">
                        <span className="text-blue-500 font-bold">01.</span>
                        <span>Selecciona "Medios Digitales" para rastrear prensa nacional.</span>
                      </li>
                      <li className="flex gap-2">
                        <span className="text-blue-500 font-bold">02.</span>
                        <span>El sistema buscará noticias relacionadas con delitos financieros y capturas.</span>
                      </li>
                      <li className="flex gap-2">
                        <span className="text-blue-500 font-bold">03.</span>
                        <span>Los resultados aparecerán en la "Bandeja" listos para ser analizados.</span>
                      </li>
                    </ul>
                  </section>
                </div>

                {/* AI Analysis */}
                <section>
                  <div className="flex items-center gap-3 mb-4">
                    <Shield className="w-5 h-5 text-blue-600" />
                    <h3 className="text-lg font-bold text-slate-900">Análisis con Inteligencia Artificial</h3>
                  </div>
                  <div className="bg-blue-50 p-8 rounded-[2rem] border border-blue-100">
                    <p className="text-blue-900 text-sm mb-6 font-medium">
                      Una vez que las noticias están en la "Bandeja", el proceso es simple:
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-center">
                      <div className="space-y-2">
                        <div className="text-blue-600 font-serif text-2xl italic">1</div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-blue-800">Seleccionar</p>
                        <p className="text-[10px] text-blue-600/70">Marca las noticias que deseas procesar.</p>
                      </div>
                      <div className="space-y-2">
                        <div className="text-blue-600 font-serif text-2xl italic">2</div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-blue-800">Analizar</p>
                        <p className="text-[10px] text-blue-600/70">Presiona "Analizar con IA" para extraer sujetos y delitos.</p>
                      </div>
                      <div className="space-y-2">
                        <div className="text-blue-600 font-serif text-2xl italic">3</div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-blue-800">Exportar</p>
                        <p className="text-[10px] text-blue-600/70">Descarga tus hallazgos en PDF o Excel para tu expediente.</p>
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            </div>

            {/* Footer */}
            <div className="p-8 bg-slate-50 border-t border-slate-100 text-center">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.4em]">Cumplimiento SV • Inteligencia para la Prevención</p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
