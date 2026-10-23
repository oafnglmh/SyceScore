import { Check, Circle, Loader2 } from 'lucide-react'
import { PROCESSING_STEPS } from '../constants'

/**
 * @param {{
 *   currentStep: string,  // step id
 *   progress?: { step: string, message?: string, percent?: number }
 * }} props
 */
export function ProgressStepper({ currentStep, progress }) {
  const currentIdx = PROCESSING_STEPS.findIndex((s) => s.id === currentStep)

  return (
    <div className="flex flex-col gap-4">
      <ol className="relative ml-2">
        {PROCESSING_STEPS.map((step, idx) => {
          const done = idx < currentIdx
          const active = idx === currentIdx
          const pending = idx > currentIdx

          return (
            <li key={step.id} className="flex items-start gap-3 mb-4 last:mb-0">
              {/* Step icon */}
              <div className="flex flex-col items-center">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0
                    ${done ? 'bg-emerald-100 text-emerald-600' : ''}
                    ${active ? 'bg-blue-100 text-blue-600' : ''}
                    ${pending ? 'bg-slate-100 text-slate-400' : ''}
                  `}
                >
                  {done && <Check size={14} strokeWidth={2.5} />}
                  {active && <Loader2 size={14} className="animate-spin" />}
                  {pending && <Circle size={10} />}
                </div>
                {idx < PROCESSING_STEPS.length - 1 && (
                  <div
                    className={`w-px flex-1 mt-1 mb-0 h-5
                      ${done ? 'bg-emerald-200' : 'bg-slate-200'}
                    `}
                  />
                )}
              </div>

              {/* Step label */}
              <div className="pt-1">
                <p
                  className={`text-sm font-medium
                    ${done ? 'text-emerald-700' : ''}
                    ${active ? 'text-blue-700' : ''}
                    ${pending ? 'text-slate-400' : ''}
                  `}
                >
                  {step.label}
                </p>
                {active && progress?.message && (
                  <p className="text-xs text-slate-500 mt-0.5">
                    {progress.message}
                  </p>
                )}
              </div>
            </li>
          )
        })}
      </ol>

      {/* Progress bar */}
      {typeof progress?.percent === 'number' && (
        <div>
          <div className="flex justify-between text-xs text-slate-500 mb-1">
            <span>{progress.message || 'Đang xử lý...'}</span>
            <span>{progress.percent}%</span>
          </div>
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-500"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
