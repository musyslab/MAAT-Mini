import { Link } from 'react-router-dom'
import maatMiniLogo from '../../images/MAAT-Mini.png'
import '../../styling/MenuComponent.scss'

interface MenuComponentProps {
  showUpload: boolean
  showAdminUpload: boolean
  showHelp: boolean
  showCreate: boolean
  showReviewButton: boolean
  showLast: boolean
}

export default function MenuComponent(_props: MenuComponentProps) {
  return (
    <nav className="menu menu--top menu--inverted menu--borderless menu--huge">
      <div className="menu__container">
        <Link className="menu__item menu__item--header" to="/admin/schools">
          <img src={maatMiniLogo} alt="MAAT-Mini" className="menu__logo" />
        </Link>
      </div>
    </nav>
  )
}