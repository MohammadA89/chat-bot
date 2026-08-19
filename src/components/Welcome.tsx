import { IconBook, IconBulb, IconCode, IconPen, IconSparkles } from './Icons'

interface WelcomeProps {
  onPick: (prompt: string) => void
}

const SUGGESTIONS = [
  {
    icon: <IconCode className="suggestion-icon" />,
    title: 'نوشتن کد',
    text: 'یک تابع در پایتون بنویس که فایل CSV را بخواند و رکوردهای تکراری را حذف کند.',
  },
  {
    icon: <IconBook className="suggestion-icon" />,
    title: 'توضیح یک مفهوم',
    text: 'تفاوت بین احراز هویت و مجوزدهی را با یک مثال ساده توضیح بده.',
  },
  {
    icon: <IconPen className="suggestion-icon" />,
    title: 'بازنویسی متن',
    text: 'این متن را روان‌تر و حرفه‌ای‌تر بازنویسی کن: ',
  },
  {
    icon: <IconBulb className="suggestion-icon" />,
    title: 'ایده‌پردازی',
    text: 'پنج ایده برای بهبود تجربه‌ی کاربری یک اپلیکیشن فروشگاهی پیشنهاد بده.',
  },
]

export function Welcome({ onPick }: WelcomeProps) {
  return (
    <div className="welcome">
      <div className="welcome-mark">
        <IconSparkles size={30} />
      </div>

      <div>
        <h2>چطور می‌توانم کمکتان کنم؟</h2>
        <p>سؤال خود را بنویسید یا یکی از نمونه‌های زیر را انتخاب کنید.</p>
      </div>

      <div className="suggestions">
        {SUGGESTIONS.map((s) => (
          <button key={s.title} className="suggestion" onClick={() => onPick(s.text)}>
            {s.icon}
            <div>
              <strong>{s.title}</strong>
              <span>{s.text}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
